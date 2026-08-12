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

const readTool = (registration: SkillRegistration) => {
  const tool = registration.tools?.find((item) =>
    item.name === "vault_kv_read"
  );
  if (tool === undefined) throw new Error("vault_kv_read not registered");
  return tool;
};

afterEach(() => {
  mock.restore();
});

describe("vault skill", () => {
  it("registers nothing when disabled (no settings block)", () => {
    expect(register(context({})).tools ?? []).toHaveLength(0);
  });

  it("exposes vault_kv_read when enabled", () => {
    const registration = register(context({ vault }));
    expect(registration.tools).toHaveLength(1);
    expect(readTool(registration).name).toBe("vault_kv_read");
  });

  it("fails closed on a non-allowlisted path without calling Vault or echoing the path", async () => {
    const { calls } = stubFetch(() =>
      Promise.reject(new Error("should not be reached"))
    );
    const tool = readTool(register(context({ vault })));
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

  it("reads an allowlisted KV v2 path and returns a single field", async () => {
    stubFetch(() => Promise.resolve(kvBody({ username: "u", password: "p" })));
    const tool = readTool(register(context({ vault })));
    expect(await tool.execute({ path: "secret/data/app", field: "password" }))
      .toBe("p");
  });

  it("returns the whole data map when no field is given", async () => {
    stubFetch(() => Promise.resolve(kvBody({ username: "u", password: "p" })));
    const tool = readTool(register(context({ vault })));
    expect(await tool.execute({ path: "secret/data/app" })).toBe(
      JSON.stringify({ username: "u", password: "p" }),
    );
  });

  it("sends the token in the header but never returns or logs it", async () => {
    const { calls } = stubFetch(() => Promise.resolve(kvBody({ k: "v" })));
    const tool = readTool(register(context({ vault })));
    const result = await tool.execute({ path: "secret/data/app" });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-vault-token"]).toBe(vault.token);
    expect(calls[0]?.url).toBe("https://vault.example:8200/v1/secret/data/app");
    expect(result).not.toContain(vault.token);
  });

  it("raises a generic error on an HTTP failure, leaking neither token nor path", async () => {
    stubFetch(() => Promise.resolve(new Response("denied", { status: 403 })));
    const tool = readTool(register(context({ vault })));
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
    const tool = readTool(register(context({ vault })));
    try {
      await tool.execute({ path: "secret/data/app" });
      throw new Error("expected a transport failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Vault request failed");
      expect(message).not.toContain("vault.example");
    }
  });

  it("raises a generic error when the requested field is absent", async () => {
    stubFetch(() => Promise.resolve(kvBody({ username: "u" })));
    const tool = readTool(register(context({ vault })));
    await expect(tool.execute({ path: "secret/data/app", field: "password" }))
      .rejects.toThrow("Requested field is absent at the Vault path");
  });
});
