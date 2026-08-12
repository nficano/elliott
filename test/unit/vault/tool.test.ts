import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { register } from "../../../skills/vault/src/index";
import { standaloneFacilityDirectory } from "../../../src/runtime/skills/facilities";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  RuntimeSettings,
  VaultSettings,
} from "../../../src/runtime/types";

const vault: VaultSettings = {
  address: "https://vault.example:8200",
  token: "hvs.SUPERSECRETTOKEN",
  paths: ["secret/data/app"],
};

const context = (settings: Partial<RuntimeSettings>): SkillContext => ({
  settings: settings as RuntimeSettings,
  stateDirectory: ".elliott-runtime/vault-test",
  facilities: standaloneFacilityDirectory(),
  packages: () => [],
  report: () => {},
  installErrorSink: () => {},
  deliver: async () => {},
});

const stubFetch = (
  handler: (init: RequestInit) => Promise<Response>,
): { readonly calls: readonly { url: string; init: RequestInit; }[]; } => {
  const calls: { url: string; init: RequestInit; }[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const resolved = init ?? {};
    calls.push({ url: String(input), init: resolved });
    return handler(resolved);
  };
  spyOn(globalThis, "fetch").mockImplementation(
    impl as unknown as typeof fetch,
  );
  return { calls };
};

const kvBody = (data: Readonly<Record<string, unknown>>): Response =>
  Response.json({ data: { data } }, { status: 200 });

const describeTool = (registration: SkillRegistration) => {
  const tool = registration.tools?.find((item) =>
    item.name === "vault_kv_describe"
  );
  if (tool === undefined) throw new Error("vault_kv_describe not registered");
  return tool;
};

afterEach(() => {
  mock.restore();
});

describe("vault skill", () => {
  it("registers nothing when disabled (no settings block)", () => {
    expect(register(context({})).tools ?? []).toHaveLength(0);
  });

  it("exposes vault_kv_describe when enabled", () => {
    const registration = register(context({ vault }));
    expect(registration.tools).toHaveLength(1);
    expect(describeTool(registration).name).toBe("vault_kv_describe");
  });

  it("fails closed on a non-allowlisted path without calling Vault or echoing the path", async () => {
    const { calls } = stubFetch(() =>
      Promise.reject(new Error("should not be reached"))
    );
    const tool = describeTool(register(context({ vault })));
    try {
      await tool.execute({ path: "secret/data/other" });
      throw new Error("expected a denial");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Requested path is not on the Vault allowlist");
      expect(message).not.toContain("secret/data/other");
    }
    expect(calls).toHaveLength(0);
  });

  it("returns field NAMES for a path, never the secret values", async () => {
    stubFetch(() =>
      Promise.resolve(kvBody({ password: "SUPERSECRET", username: "u" }))
    );
    const tool = describeTool(register(context({ vault })));
    const result = await tool.execute({ path: "secret/data/app" });
    expect(JSON.parse(result)).toEqual({
      path: "secret/data/app",
      fields: ["password", "username"],
    });
    // The secret value is never in the tool output that reaches model context.
    expect(result).not.toContain("SUPERSECRET");
    expect(result).not.toContain("\"u\"");
  });

  it("reports whether a single field is provisioned, without its value", async () => {
    stubFetch(() =>
      Promise.resolve(kvBody({ password: "SUPERSECRET", blank: "" }))
    );
    const tool = describeTool(register(context({ vault })));
    const present = await tool.execute({
      path: "secret/data/app",
      field: "password",
    });
    expect(JSON.parse(present)).toEqual({
      path: "secret/data/app",
      field: "password",
      present: true,
    });
    expect(present).not.toContain("SUPERSECRET");
    // An empty value reads as not provisioned.
    expect(
      JSON.parse(
        await tool.execute({ path: "secret/data/app", field: "blank" }),
      ),
    )
      .toEqual({ path: "secret/data/app", field: "blank", present: false });
    // An absent field reads as not provisioned (no throw, no value).
    expect(
      JSON.parse(
        await tool.execute({ path: "secret/data/app", field: "nope" }),
      ),
    ).toEqual({ path: "secret/data/app", field: "nope", present: false });
  });

  it("sends the token in the header but never returns or logs it", async () => {
    const { calls } = stubFetch(() =>
      Promise.resolve(kvBody({ k: "SECRETVALUE" }))
    );
    const tool = describeTool(register(context({ vault })));
    const result = await tool.execute({ path: "secret/data/app" });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-vault-token"]).toBe(vault.token);
    expect(calls[0]?.url).toBe("https://vault.example:8200/v1/secret/data/app");
    expect(result).not.toContain(vault.token);
    expect(result).not.toContain("SECRETVALUE");
  });

  it("raises a generic error on an HTTP failure, leaking neither token nor path", async () => {
    stubFetch(() => Promise.resolve(new Response("denied", { status: 403 })));
    const tool = describeTool(register(context({ vault })));
    try {
      await tool.execute({ path: "secret/data/app" });
      throw new Error("expected an HTTP failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Vault returned HTTP 403");
      expect(message).not.toContain(vault.token);
      expect(message).not.toContain("secret/data/app");
    }
  });

  it("raises a generic error on a transport failure", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED vault.example")));
    const tool = describeTool(register(context({ vault })));
    try {
      await tool.execute({ path: "secret/data/app" });
      throw new Error("expected a transport failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Vault request failed");
      expect(message).not.toContain("vault.example");
    }
  });
});
