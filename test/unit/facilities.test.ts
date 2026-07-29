import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  RuntimeFacilityDirectory,
  stableStringify,
  standaloneFacilityDirectory,
} from "../../src/runtime/skills/facilities";
import { assertMatchesSchema } from "../../src/runtime/skills/schema";
import type {
  FacilityBinding,
  FacilityGrant,
} from "../../src/runtime/skills/types";
import type { EchoBinding } from "./types";

// Unit coverage for the facility seam itself: the directory (registration,
// consumer scoping, validation, idempotent grants, persistence, release) and
// the JSON-schema subset validator behind it. See docs/skill-facilities.md.

const tempState = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "elliott-facilities-"));

const echoBinding = (overrides: Partial<FacilityBinding> = {}): EchoBinding => {
  const acquired: EchoBinding["acquired"] = [];
  const released: string[] = [];
  const binding: FacilityBinding = {
    id: "test.echo",
    version: 1,
    describe: () => ({
      id: "test.echo",
      version: 1,
      description: "echoes its request back as a grant",
      requestSchema: {
        type: "object",
        required: ["value"],
        additionalProperties: false,
        properties: {
          value: { type: "string" },
          count: { type: "integer" },
        },
      },
      grantSchema: {
        type: "object",
        required: ["echoed"],
        additionalProperties: false,
        properties: { echoed: { type: "string" } },
      },
    }),
    acquire: async (request): Promise<FacilityGrant> => {
      acquired.push({
        consumer: request.consumer,
        name: request.name,
        config: request.config,
      });
      return {
        grantId: `echo:${request.consumer}:${request.name}:${acquired.length}`,
        facility: "test.echo@1",
        values: { echoed: String(request.config["value"]) },
      };
    },
    release: async (grantId) => {
      released.push(grantId);
    },
    ...overrides,
  };
  return { binding, acquired, released };
};

describe("RuntimeFacilityDirectory registration", () => {
  it("lists and describes registered facilities", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    directory.register("provider-a", echoBinding().binding);

    expect(directory.list().map((item) => item.id)).toEqual(["test.echo"]);
    expect(directory.describe("test.echo")?.version).toBe(1);
    expect(directory.describe("test.missing")).toBeUndefined();
  });

  it("rejects a duplicate facility id naming both providers", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    directory.register("provider-a", echoBinding().binding);

    expect(() => directory.register("provider-b", echoBinding().binding))
      .toThrow(/provided by both provider-a and provider-b/);
  });

  it("refuses acquire and release through the provider view", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    directory.register("provider-a", echoBinding().binding);
    const view = directory.providerView();

    expect(view.list().map((item) => item.id)).toEqual(["test.echo"]);
    await expect(view.acquire("test.echo", "x", { value: "v" }))
      .rejects.toThrow(/providers may not acquire/i);
    await expect(view.release("echo:any")).rejects.toThrow(/may not release/i);
  });
});

describe("RuntimeFacilityDirectory acquire", () => {
  it("stamps the consumer from the scoped view, not caller input", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);

    await directory.scoped("skill-one").acquire("test.echo", "primary", {
      value: "v",
    });

    expect(echo.acquired).toHaveLength(1);
    expect(echo.acquired[0]?.consumer).toBe("skill-one");
    expect(echo.acquired[0]?.name).toBe("primary");
  });

  it("fails hard when no provider offers the facility", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const scoped = directory.scoped("skill-one");

    await expect(scoped.acquire("ingress.webhook", "hook", {}))
      .rejects.toThrow(/No skill provides the facility ingress.webhook/);
  });

  it("validates the request config against the request schema", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);
    const scoped = directory.scoped("skill-one");

    await expect(scoped.acquire("test.echo", "a", {}))
      .rejects.toThrow(/missing required property value/);
    await expect(scoped.acquire("test.echo", "a", { value: 5 }))
      .rejects.toThrow(/value must be of type string/);
    await expect(scoped.acquire("test.echo", "a", { value: "v", count: 1.5 }))
      .rejects.toThrow(/count must be of type integer/);
    await expect(scoped.acquire("test.echo", "a", { value: "v", junk: true }))
      .rejects.toThrow(/unexpected property junk/);
    expect(echo.acquired).toHaveLength(0);
  });

  it("validates the grant values against the grant schema", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const broken = echoBinding({
      acquire: async () => ({
        grantId: "broken:1",
        facility: "test.echo@1",
        values: { unexpected: true },
      }),
    });
    directory.register("provider-a", broken.binding);

    await expect(
      directory.scoped("skill-one").acquire("test.echo", "a", { value: "v" }),
    ).rejects.toThrow(/grant is missing required property echoed/);
  });

  it("is idempotent per (consumer, name): same config reuses the stored grant", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);
    const scoped = directory.scoped("skill-one");

    const first = await scoped.acquire("test.echo", "a", {
      value: "v",
      count: 2,
    });
    // Same config in a different key order must not re-invoke the provider.
    const second = await scoped.acquire("test.echo", "a", {
      count: 2,
      value: "v",
    });

    expect(second).toEqual(first);
    expect(echo.acquired).toHaveLength(1);
  });

  it("re-invokes the provider when the config changes", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);
    const scoped = directory.scoped("skill-one");

    await scoped.acquire("test.echo", "a", { value: "v1" });
    const updated = await scoped.acquire("test.echo", "a", { value: "v2" });

    expect(echo.acquired).toHaveLength(2);
    expect(updated.values["echoed"]).toBe("v2");
  });

  it("keeps grants separate per consumer and per name", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);

    const one = await directory.scoped("skill-one")
      .acquire("test.echo", "a", { value: "v" });
    const two = await directory.scoped("skill-two")
      .acquire("test.echo", "a", { value: "v" });
    const three = await directory.scoped("skill-one")
      .acquire("test.echo", "b", { value: "v" });

    expect(new Set([one.grantId, two.grantId, three.grantId]).size).toBe(3);
    expect(echo.acquired).toHaveLength(3);
  });
});

describe("RuntimeFacilityDirectory persistence", () => {
  it("survives a reboot: a fresh directory returns the stored grant without re-provisioning", async () => {
    const state = await tempState();
    const first = new RuntimeFacilityDirectory(state);
    const echoOne = echoBinding();
    first.register("provider-a", echoOne.binding);
    const grant = await first.scoped("skill-one")
      .acquire("test.echo", "a", { value: "v" });

    const second = new RuntimeFacilityDirectory(state);
    const echoTwo = echoBinding();
    second.register("provider-a", echoTwo.binding);
    const replay = await second.scoped("skill-one")
      .acquire("test.echo", "a", { value: "v" });

    expect(replay).toEqual(grant);
    expect(echoTwo.acquired).toHaveLength(0);
  });

  it("writes grants.json atomically and leaves no draft behind", async () => {
    const state = await tempState();
    const directory = new RuntimeFacilityDirectory(state);
    directory.register("provider-a", echoBinding().binding);
    await directory.scoped("skill-one").acquire("test.echo", "a", {
      value: "v",
    });

    const files = await readdir(path.join(state, "facilities"));
    expect(files).toEqual(["grants.json"]);
    const stored = JSON.parse(
      await readFile(path.join(state, "facilities", "grants.json"), "utf8"),
    );
    expect(stored.grants).toHaveLength(1);
    expect(stored.grants[0].consumer).toBe("skill-one");
    expect(stored.grants[0].grant.values.echoed).toBe("v");
  });

  it("treats a corrupt grants file as empty instead of failing the boot", async () => {
    const state = await tempState();
    await mkdir(path.join(state, "facilities"), { recursive: true });
    await writeFile(path.join(state, "facilities", "grants.json"), "{nope");
    const first = new RuntimeFacilityDirectory(state);
    const echo = echoBinding();
    first.register("provider-a", echo.binding);

    const grant = await first.scoped("skill-one")
      .acquire("test.echo", "a", { value: "v" });

    expect(grant.values["echoed"]).toBe("v");
    expect(echo.acquired).toHaveLength(1);
  });
});

describe("RuntimeFacilityDirectory release", () => {
  it("releases through the provider and forgets the grant", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);
    const scoped = directory.scoped("skill-one");
    const grant = await scoped.acquire("test.echo", "a", { value: "v" });

    await scoped.release(grant.grantId);

    expect(echo.released).toEqual([grant.grantId]);
    // The grant is gone, so the next acquire provisions anew.
    await scoped.acquire("test.echo", "a", { value: "v" });
    expect(echo.acquired).toHaveLength(2);
  });

  it("refuses to release an unknown or foreign grant", async () => {
    const directory = new RuntimeFacilityDirectory(await tempState());
    const echo = echoBinding();
    directory.register("provider-a", echo.binding);
    const grant = await directory.scoped("skill-one")
      .acquire("test.echo", "a", { value: "v" });

    await expect(directory.scoped("skill-one").release("echo:nope"))
      .rejects.toThrow(/holds no grant/);
    // Another consumer cannot tear down skill-one's resource.
    await expect(directory.scoped("skill-two").release(grant.grantId))
      .rejects.toThrow(/holds no grant/);
    expect(echo.released).toEqual([]);
  });
});

describe("standalone facility directory", () => {
  it("behaves like a directory with no providers", async () => {
    const directory = standaloneFacilityDirectory();
    expect(directory.list()).toEqual([]);
    expect(directory.describe("test.echo")).toBeUndefined();
    await expect(directory.acquire("test.echo", "a", {}))
      .rejects.toThrow(/No skill provides/);
  });
});

describe("stableStringify", () => {
  it("is key-order insensitive and array-order sensitive", () => {
    expect(stableStringify({ a: 1, b: [1, 2] }))
      .toBe(stableStringify({ b: [1, 2], a: 1 }));
    expect(stableStringify({ b: [2, 1] }))
      .not.toBe(stableStringify({ b: [1, 2] }));
    expect(stableStringify({ nested: { y: 2, x: 1 } }))
      .toBe(stableStringify({ nested: { x: 1, y: 2 } }));
  });
});

describe("assertMatchesSchema", () => {
  const schema = {
    type: "object",
    required: ["kind"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["a", "b"] },
      flag: { type: "boolean" },
      size: { type: "number" },
      items: { type: "array", items: { type: "string" } },
      nested: {
        type: "object",
        required: ["inner"],
        properties: { inner: { type: "integer" } },
      },
    },
  } as const;

  it("accepts a conforming value", () => {
    expect(() =>
      assertMatchesSchema(
        {
          kind: "a",
          flag: true,
          size: 1.5,
          items: ["x"],
          nested: { inner: 3 },
        },
        schema,
        "value",
      )
    ).not.toThrow();
  });

  it("names the failing path in every rejection", () => {
    expect(() => assertMatchesSchema({}, schema, "value"))
      .toThrow("value is missing required property kind");
    expect(() => assertMatchesSchema({ kind: "c" }, schema, "value"))
      .toThrow("value.kind must be one of a, b");
    expect(() => assertMatchesSchema({ kind: "a", flag: 1 }, schema, "value"))
      .toThrow("value.flag must be of type boolean");
    expect(() =>
      assertMatchesSchema({ kind: "a", items: ["x", 2] }, schema, "value")
    ).toThrow("value.items[1] must be of type string");
    expect(() =>
      assertMatchesSchema({ kind: "a", nested: {} }, schema, "value")
    ).toThrow("value.nested is missing required property inner");
    expect(() =>
      assertMatchesSchema({ kind: "a", nested: { inner: 1.2 } }, schema, "v")
    ).toThrow("v.nested.inner must be of type integer");
    expect(() => assertMatchesSchema({ kind: "a", zz: 1 }, schema, "value"))
      .toThrow("value has unexpected property zz");
  });

  it("treats a schema without a type as open", () => {
    expect(() => assertMatchesSchema("anything", {}, "value")).not.toThrow();
  });
});
