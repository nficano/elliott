import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPackageAt } from "../../../src/catalog/bundled";
import { runInstall } from "../../../src/install/index";
import { assertNoFatalOutcomes } from "../../../src/install/installer";
import { InstallError } from "../../../src/install/types";
import type {
  InstallSettings,
  RegistryClient,
  RegistryTag,
} from "../../../src/install/types";
import { loadSkillRegistrations } from "../../../src/runtime/skills/loader";

// Build a .tar.gz shaped exactly like a GitHub codeload archive: a single
// top-level dir named skills-<tag-with-slashes-as-dashes>, with the skill
// subtree under it. This exercises the real system-`tar` extract path and the
// read-root-from-archive logic.
const buildTarball = async (
  skill: string,
  version: string,
): Promise<Uint8Array> => {
  const tag = `${skill}/v${version}`;
  const rootName = `skills-${tag.replaceAll("/", "-")}`;
  const staging = await mkdtemp(path.join(tmpdir(), "reg-"));
  const skillDir = path.join(staging, rootName, skill);
  await mkdir(path.join(skillDir, "src"), { recursive: true });
  await writeFile(
    path.join(skillDir, "manifest.yaml"),
    `apiVersion: elliott/v1
kind: tool
profile: tool-standard
metadata: { namespace: registry-test, name: ${skill}, version: ${version} }
spec:
  document: TOOL.md
  protocols: [tool.executor]
  egress: { class: none }
  isolation: container
  exports:
    - { ref: tool/${skill}, implementation: src/index.ts }
`,
  );
  await writeFile(path.join(skillDir, "TOOL.md"), `# ${skill}\n`);
  await writeFile(
    path.join(skillDir, "src", "index.ts"),
    `export const register = () => ({
  tools: [{
    name: "${skill.replaceAll("-", "_")}_ping",
    description: "ping",
    inputSchema: { type: "object", properties: {} },
    execute: async () => "pong ${version}",
  }],
});
`,
  );
  const out = path.join(staging, "out.tgz");
  const proc = Bun.spawn(["tar", "-czf", out, "-C", staging, rootName]);
  await proc.exited;
  const bytes = new Uint8Array(await readFile(out));
  await rm(staging, { recursive: true, force: true });
  return bytes;
};

const fixtureRegistry = (
  tags: readonly RegistryTag[],
  options: { readonly failList?: boolean; readonly failFetch?: boolean; } = {},
): RegistryClient & { fetches: number; } => {
  const client = {
    fetches: 0,
    listTags: async (): Promise<readonly RegistryTag[]> => {
      if (options.failList) throw new InstallError("registry down");
      return tags;
    },
    fetchTarball: async (tag: string): Promise<Uint8Array> => {
      client.fetches += 1;
      if (options.failFetch) throw new InstallError("codeload down");
      const parsed = /^(.+)\/v(\d+\.\d+\.\d+)$/.exec(tag);
      if (parsed === null) throw new InstallError(`bad tag ${tag}`);
      return buildTarball(parsed[1] as string, parsed[2] as string);
    },
  };
  return client;
};

const settings = (skills: readonly string[]): InstallSettings => ({
  registry: "nficano/skills",
  refresh: true,
  skills: skills.map((raw) => {
    const at = raw.indexOf("@");
    const name = at === -1 ? raw : raw.slice(0, at);
    return {
      name,
      ...(at !== -1 && { version: raw.slice(at + 1) }),
      required: name.startsWith("gateway-"),
    };
  }),
});

const agentRoot = async (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "agent-"));

describe("installer", () => {
  it("resolves unpinned latest, materializes, and writes a verifiable lock", async () => {
    const root = await agentRoot();
    const registry = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
      { name: "demo", version: "1.2.0", tag: "demo/v1.2.0" },
    ]);
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry,
    });
    expect(result.outcomes[0]?.state).toBe("ok");
    expect(result.outcomes[0]?.resolved).toBe("1.2.0");

    const lock = JSON.parse(
      await readFile(path.join(root, "skills.lock.json"), "utf8"),
    );
    expect(lock.skills.demo.version).toBe("1.2.0");
    expect(lock.skills.demo.digest).toMatch(/^sha256-/);

    // The materialized directory loads as a package and registers its tool.
    const pkg = await loadPackageAt(result.directories[0] as string);
    expect(pkg.name).toBe("demo");
  });

  it("boots from a warm cache with no network fetch (frozen)", async () => {
    const root = await agentRoot();
    const seed = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
    ]);
    await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry: seed,
    });

    // Frozen boot with a registry that throws on fetch — the cache hit must
    // avoid the network entirely.
    const offline = fixtureRegistry([], { failFetch: true });
    const frozen = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "frozen",
      registry: offline,
    });
    expect(frozen.outcomes[0]?.state).toBe("ok");
    expect(offline.fetches).toBe(0);
  });

  it("falls back to cache when the registry listing is down (refresh)", async () => {
    const root = await agentRoot();
    const seed = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
    ]);
    await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry: seed,
    });

    const down = fixtureRegistry([], { failList: true });
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry: down,
    });
    expect(result.outcomes[0]?.state).toBe("cached-fallback");
  });

  it("fails a frozen install when no lock entry exists", async () => {
    const root = await agentRoot();
    const registry = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
    ]);
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "frozen",
      registry,
    });
    expect(result.outcomes[0]?.state).toBe("failed");
  });

  it("fails when a cached dir's digest no longer matches the lock (tamper)", async () => {
    const root = await agentRoot();
    const seed = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
    ]);
    const first = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry: seed,
    });
    // Corrupt the cached file, then a frozen boot with no network must fail
    // rather than load poisoned bytes.
    await writeFile(
      path.join(first.directories[0] as string, "TOOL.md"),
      "tampered",
    );
    const offline = fixtureRegistry([], { failFetch: true });
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "frozen",
      registry: offline,
    });
    expect(result.outcomes[0]?.state).toBe("failed");
  });

  it("assertNoFatalOutcomes throws only on required failures", async () => {
    const root = await agentRoot();
    const registry = fixtureRegistry([]);
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["gateway-slack"]),
      mode: "refresh",
      registry,
    });
    expect(result.outcomes[0]?.state).toBe("failed");
    expect(() => assertNoFatalOutcomes(result.outcomes)).toThrow(InstallError);
  });

  it("rejects a tarball whose skill carries a nested package.json", async () => {
    const root = await agentRoot();
    const registry: RegistryClient = {
      listTags:
        async () => [{ name: "demo", version: "1.0.0", tag: "demo/v1.0.0" }],
      fetchTarball: async () => {
        // Build a tarball then inject a package.json into the skill subtree.
        const staging = await mkdtemp(path.join(tmpdir(), "reg-"));
        const skillDir = path.join(staging, "skills-demo-v1.0.0", "demo");
        await mkdir(path.join(skillDir, "src"), { recursive: true });
        await writeFile(
          path.join(skillDir, "manifest.yaml"),
          `apiVersion: elliott/v1\nkind: tool\nprofile: tool-standard\nmetadata: { namespace: t, name: demo, version: 1.0.0 }\nspec:\n  document: TOOL.md\n  protocols: [tool.executor]\n  egress: { class: none }\n  isolation: container\n  exports:\n    - { ref: tool/demo, implementation: src/index.ts }\n`,
        );
        await writeFile(path.join(skillDir, "TOOL.md"), "# demo\n");
        await writeFile(
          path.join(skillDir, "src", "index.ts"),
          "export const register = () => ({});\n",
        );
        await writeFile(path.join(skillDir, "package.json"), "{}\n");
        const out = path.join(staging, "out.tgz");
        await (Bun.spawn([
          "tar",
          "-czf",
          out,
          "-C",
          staging,
          "skills-demo-v1.0.0",
        ]).exited);
        return new Uint8Array(await readFile(out));
      },
    };
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry,
    });
    expect(result.outcomes[0]?.state).toBe("failed");
    expect(result.outcomes[0]?.error).toContain("package.json");
  });
});

// Prove an installed package flows through the real registration seam.
describe("installed skill registration", () => {
  it("registers its tool through loadSkillRegistrations", async () => {
    const root = await agentRoot();
    const registry = fixtureRegistry([
      { name: "demo", version: "1.0.0", tag: "demo/v1.0.0" },
    ]);
    const result = await runInstall({
      agentRoot: root,
      settings: settings(["demo"]),
      mode: "refresh",
      registry,
    });
    const pkg = await loadPackageAt(result.directories[0] as string);
    const loaded = await loadSkillRegistrations([pkg], {
      settings: {} as never,
      stateDirectory: path.join(root, ".state"),
      packages: () => [],
      report: () => {},
      deliver: async () => {},
    });
    const tools = loaded.flatMap((skill) => skill.registration.tools ?? []);
    expect(tools.map((tool) => tool.name)).toContain("demo_ping");
  });
});
