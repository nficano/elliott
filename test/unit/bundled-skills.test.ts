import Ajv from "ajv";
import { describe, expect, it } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { BUNDLED_CATALOG, loadBundledPackages } from "../../src/catalog/index";
import { collectPackageViews } from "../../src/runtime/skills/loader";

const root = path.resolve(import.meta.dir, "../..");

const IMPLEMENTED = [
  "deep-trace",
  "evaluator-agent-benchmarks",
  "evaluator-darwinian",
  "evaluator-dspy",
  "fetch",
  "files",
  "gateway-bluebubbles",
  "gateway-email",
  "gateway-gmail",
  "gateway-slack",
  "gateway-webhook",
  "glitchtip",
  "mcp-client",
  "scheduler",
  "search-brave",
  "search-duckduckgo",
  "ssh",
  "terminal",
  "traefik",
  "vault",
  "web-firecrawl",
  "web-parallel",
  "webhook-provisioner",
];

describe("Elliott bundled component packages", () => {
  it("ships a complete package for every TDD catalog entry", async () => {
    const packages = await loadBundledPackages(root);
    const packageNames = packages
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    const catalogNames = BUNDLED_CATALOG
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    expect(packageNames).toEqual(catalogNames);
    expect(packageNames).toContain("mcp-client");
    expect(packageNames).toContain("deep-trace");
    expect(
      path.relative(
        path.join(root, "skills"),
        packages.find((item) => item.name === "evaluator-dspy")?.directory
          ?? "",
      ),
    ).toBe("evaluator-dspy");
    for (const item of packages) {
      expect(item.profile.length).toBeGreaterThan(0);
      expect(item.protocols.length).toBeGreaterThan(0);
      await access(path.join(item.directory, "manifest.yaml"));
      await access(path.join(item.directory, item.document));
    }
  });

  it("ships a manifest.yaml valid against schemas/elliott-component.json for every package", async () => {
    // Nothing in the runtime boot path exercises this schema (bundled.ts
    // reads only document/protocols/exports — see the module comment on
    // ComponentSchemaRegistry), so a manifest can drift out of sync with the
    // canonical schema without any other test catching it. This is the one
    // place that actually compiles the schema and validates every real
    // manifest.yaml against it, not a synthetic fixture.
    const schema: object = JSON.parse(
      await readFile(path.join(root, "schemas/elliott-component.json"), "utf8"),
    );
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const packages = await loadBundledPackages(root);
    for (const item of packages) {
      const manifest: unknown = parse(
        await readFile(path.join(item.directory, "manifest.yaml"), "utf8"),
      );
      const valid = validate(manifest);
      expect([item.name, valid, validate.errors]).toEqual([
        item.name,
        true,
        null,
      ]);
    }
  });

  it("ships an agentskills.io-conformant SKILL.md for every package", async () => {
    // Every package is a valid agentskills.io skill: its document is SKILL.md
    // with frontmatter whose `name` obeys the spec's charset/length rules and
    // equals both the leaf directory and the manifest identity, plus a
    // non-empty, bounded `description`. See https://agentskills.io/specification.
    const maximumNameLength = 64;
    const maximumDescriptionLength = 1024;
    const frontmatterFence = "---\n";
    const nameCharacters = new Set("abcdefghijklmnopqrstuvwxyz0123456789");
    // agentskills.io name rule without a backtracking regex: lowercase
    // alphanumeric segments joined by single hyphens (no leading, trailing, or
    // doubled hyphen), <=64 chars. Mirrors validComponentName in scaffold.ts.
    const isConformantName = (value: string): boolean =>
      value.length > 0
      && value.length <= maximumNameLength
      && value.split("-").every((part) =>
        part.length > 0 && [...part].every((ch) => nameCharacters.has(ch))
      );
    const packages = await loadBundledPackages(root);
    for (const item of packages) {
      expect(item.document).toBe("SKILL.md");
      const markdown = await readFile(
        path.join(item.directory, "SKILL.md"),
        "utf8",
      );
      expect(markdown.startsWith(frontmatterFence)).toBe(true);
      const end = markdown.indexOf("\n---\n", frontmatterFence.length);
      expect(end).toBeGreaterThan(0);
      const parsed: unknown = parse(
        markdown.slice(frontmatterFence.length, end),
      );
      const front = (parsed ?? {}) as Readonly<Record<string, unknown>>;
      const name = front["name"];
      const description = front["description"];
      expect(typeof name).toBe("string");
      expect(isConformantName(name as string)).toBe(true);
      expect(name).toBe(path.basename(item.directory));
      expect(name).toBe(item.name);
      expect(typeof description).toBe("string");
      expect((description as string).length).toBeGreaterThan(0);
      expect((description as string).length).toBeLessThanOrEqual(
        maximumDescriptionLength,
      );
    }
  });

  it("bundles an executable module for every implemented skill", async () => {
    const packages = await loadBundledPackages(root);
    const implemented = packages.filter(
      (item) => item.entrypoint !== undefined,
    );
    const names = implemented
      .map((item) => item.name)
      .sort((left, right) => left.localeCompare(right));
    expect(names).toEqual(IMPLEMENTED);
    for (const item of implemented) {
      expect(item.exports.length).toBeGreaterThan(0);
      const module: unknown = await import(item.entrypoint!);
      const register = (module as { register?: unknown; }).register;
      expect(typeof register).toBe("function");
    }
  });

  it("carries each manifest's spec.topology block for map auto-registration", async () => {
    const packages = await loadBundledPackages(root);
    const map = packages.find((item) => item.name === "deep-trace");
    expect(map?.topology).toMatchObject({
      node: expect.objectContaining({ id: "obs.map" }),
    });
    const withTopology = packages.filter((item) => item.topology !== undefined);
    expect(withTopology.length).toBe(packages.length);
  });

  it("declares the same egress in each manifest.yaml as in the catalog", async () => {
    // The descriptor array in src/catalog/descriptors.ts and each package's
    // manifest.yaml are maintained by hand, separately, and nothing at boot
    // compares them — so an egress host added to one silently disagrees with
    // the other. Three consecutive adversary rounds filed a variant of that
    // drift. Compare the pair directly instead of trusting review to catch it.
    const packages = await loadBundledPackages(root);
    const drift: string[] = [];
    for (const item of packages) {
      const manifest = parse(
        await readFile(path.join(item.directory, "manifest.yaml"), "utf8"),
      ) as { spec?: { egress?: { class?: string; hosts?: string[]; }; }; };
      const descriptor = BUNDLED_CATALOG.find((it) => it.name === item.name);
      // egressClass() normalizes (dedupes and sorts); manifests are hand-
      // written in whatever order reads best, so compare as sets.
      const byName = (left: string, right: string): number =>
        left.localeCompare(right);
      const declared = [...manifest.spec?.egress?.hosts ?? []].sort(byName);
      const catalogued = [...descriptor?.egress.hosts ?? []].sort(byName);
      if (
        manifest.spec?.egress?.class !== descriptor?.egress.kind
        || declared.join(",") !== catalogued.join(",")
      ) {
        drift.push(item.name);
      }
    }
    expect(drift).toEqual([]);
    // Socket Mode dials a URL apps.connections.open picks at runtime; both
    // hosts Slack serves those from have to be in the exact-match allowlist.
    const slack = BUNDLED_CATALOG.find((it) => it.name === "gateway-slack");
    expect(slack?.egress.hosts).toContain("wss-primary.slack.com");
    expect(slack?.egress.hosts).toContain("wss-backup.slack.com");
  });

  it("joins catalog and registrations into SkillContext package views", async () => {
    const packages = await loadBundledPackages(root);
    // The join is by directory (name is manifest-authored and can collide), so
    // the fixture takes its directory from the package it stands in for.
    const deepTrace = packages.find((item) => item.name === "deep-trace");
    const views = collectPackageViews(packages, [{
      name: "deep-trace",
      directory: deepTrace?.directory ?? "",
      registration: {
        gateways: [{ name: "deep-trace" }],
        routes: [{ method: "GET", path: "/x" }],
        services: [{ name: "deep-trace" }],
      } as never,
    }]);
    expect(views.length).toBe(packages.length);
    const map = views.find((item) => item.name === "deep-trace");
    expect(map).toMatchObject({
      kind: "extension",
      registered: true,
      bindings: {
        tools: 0,
        gateways: 1,
        routes: 1,
        services: 1,
        facilities: 0,
      },
    });
    expect(map?.topology).toMatchObject({
      node: expect.objectContaining({ id: "obs.map" }),
    });
    const fetchView = views.find((item) => item.name === "fetch");
    expect(fetchView?.registered).toBe(false);
    expect(fetchView?.bindings.tools).toBe(0);
  });

  it("runs without a vendored secondary agent framework", async () => {
    const files = [
      "package.json",
      "Dockerfile",
      "agents/elliott.yaml",
      "src/runtime/main.ts",
      "src/runtime/config.ts",
    ];
    const contents = await Promise.all(
      files.map((file) => readFile(path.join(root, file), "utf8")),
    );
    expect(contents.join("\n")).not.toMatch(/agent[-_]kit/i);
    await expect(access(path.join(root, "vendor/agent-kit"))).rejects.toThrow();
  });
});
