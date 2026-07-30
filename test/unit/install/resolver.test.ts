import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestDirectory } from "../../../src/install/digest";
import { parseEntry, parseInstallSettings } from "../../../src/install/entry";
import {
  emptyLock,
  readLock,
  serializeLock,
  writeLock,
} from "../../../src/install/lock";
import { InstallError } from "../../../src/install/types";
import {
  compareVersions,
  latestVersion,
  parseTag,
  parseVersion,
} from "../../../src/install/version";

describe("entry grammar", () => {
  it("parses bare names as unpinned", () => {
    expect(parseEntry("traefik")).toEqual({ name: "traefik", required: false });
  });

  it("parses name@version as pinned", () => {
    expect(parseEntry("pihole@1.2.3")).toEqual({
      name: "pihole",
      version: "1.2.3",
      required: false,
    });
  });

  it("marks gateways required", () => {
    expect(parseEntry("gateway-slack").required).toBe(true);
  });

  it("rejects bad names and versions", () => {
    expect(() => parseEntry("Bad_Name")).toThrow(InstallError);
    expect(() => parseEntry("x@1.2")).toThrow(InstallError);
    expect(() => parseEntry("x@latest")).toThrow(InstallError);
  });
});

describe("install block", () => {
  it("returns undefined when absent", () => {
    expect(parseInstallSettings(undefined)).toBeUndefined();
  });

  it("defaults registry and refresh", () => {
    const settings = parseInstallSettings({ skills: ["traefik"] });
    expect(settings?.registry).toBe("nficano/skills");
    expect(settings?.refresh).toBe(false);
  });

  it("rejects duplicate skills", () => {
    expect(() => parseInstallSettings({ skills: ["a", "a"] })).toThrow(
      InstallError,
    );
  });
});

describe("versions", () => {
  it("parses only three-integer versions", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2")).toBeUndefined();
    expect(parseVersion("1.2.3-rc1")).toBeUndefined();
  });

  it("compares numerically not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("parses name/vX.Y.Z tags and rejects prereleases", () => {
    expect(parseTag("traefik/v1.0.0")).toEqual({
      name: "traefik",
      version: "1.0.0",
      tag: "traefik/v1.0.0",
    });
    expect(parseTag("traefik/v1.0.0-rc1")).toBeUndefined();
    expect(parseTag("no-version")).toBeUndefined();
  });

  it("selects semver-max, excluding prereleases already filtered", () => {
    const tags = [
      { name: "a", version: "1.0.0", tag: "a/v1.0.0" },
      { name: "a", version: "1.10.0", tag: "a/v1.10.0" },
      { name: "a", version: "1.9.0", tag: "a/v1.9.0" },
      { name: "b", version: "3.0.0", tag: "b/v3.0.0" },
    ];
    expect(latestVersion(tags, "a")).toBe("1.10.0");
    expect(latestVersion(tags, "missing")).toBeUndefined();
  });
});

describe("digest", () => {
  it("changes when a file's path or bytes change", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "digest-"));
    await writeFile(path.join(base, "a.txt"), "hello");
    const first = await digestDirectory(base);

    const changed = await mkdtemp(path.join(tmpdir(), "digest-"));
    await writeFile(path.join(changed, "a.txt"), "world");
    expect(await digestDirectory(changed)).not.toBe(first);

    const renamed = await mkdtemp(path.join(tmpdir(), "digest-"));
    await writeFile(path.join(renamed, "b.txt"), "hello");
    expect(await digestDirectory(renamed)).not.toBe(first);
  });
});

describe("lockfile", () => {
  it("round-trips with stable key ordering", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "lock-"));
    const file = path.join(base, "skills.lock.json");
    const lock = {
      version: 1 as const,
      registry: "nficano/skills",
      skills: {
        zeta: {
          version: "1.0.0",
          tag: "zeta/v1.0.0",
          digest: "sha256-z",
          pinned: false,
        },
        alpha: {
          version: "2.0.0",
          tag: "alpha/v2.0.0",
          digest: "sha256-a",
          pinned: true,
        },
      },
    };
    await writeLock(file, lock);
    const text = await readFile(file, "utf8");
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("zeta"));
    expect(text).not.toContain("resolvedAt");

    const reread = await readLock(file, "nficano/skills");
    expect(reread.skills["alpha"]?.pinned).toBe(true);
    expect(reread.skills["zeta"]?.version).toBe("1.0.0");
  });

  it("returns an empty lock for a missing file", async () => {
    const reread = await readLock("/nonexistent/skills.lock.json", "r/s");
    expect(reread).toEqual(emptyLock("r/s"));
    expect(serializeLock(reread)).toContain("\"registry\": \"r/s\"");
  });
});
