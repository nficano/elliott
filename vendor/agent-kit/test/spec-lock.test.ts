import { describe, expect, test } from "bun:test";
import {
  parseLockfile,
  RefResolutionError,
  resolveRefs,
  serializeLockfile,
  verifyAgainstHead,
} from "../src/host/spec/lock.js";
import type { GitResolver } from "../src/host/spec/lock.js";

function fakeGit(map: Record<string, string>): GitResolver {
  return {
    async revParse(rev: string): Promise<string> {
      const v = map[rev];
      if (v === undefined) throw new Error(`unknown rev ${rev}`);
      return v;
    },
  };
}

const git = fakeGit({
  "red-roster": "aaaa000",
  "red-roster:src/skills/youtube": "tree-youtube-aaa",
  "red-roster:src/skills/browser": "tree-browser-aaa",
  "loony-lionfish": "bbbb111",
  "loony-lionfish:src/skills/youtube": "tree-youtube-bbb",
  "HEAD:src/skills/youtube": "tree-youtube-aaa",
  "HEAD:src/skills/browser": "tree-browser-aaa",
});

describe("resolveRefs", () => {
  test("resolves tags to shas + skill tree hashes, deduped and sorted", async () => {
    const lock = await resolveRefs(
      [
        { skill: "youtube", ref: "red-roster" },
        { skill: "browser", ref: "red-roster" },
        { skill: "youtube", ref: "red-roster" }, // duplicate collapses
      ],
      git,
    );
    expect(lock.entries).toEqual([
      {
        skill: "browser",
        ref: "red-roster",
        sha: "aaaa000",
        path: "src/skills/browser",
        tree: "tree-browser-aaa",
      },
      {
        skill: "youtube",
        ref: "red-roster",
        sha: "aaaa000",
        path: "src/skills/youtube",
        tree: "tree-youtube-aaa",
      },
    ]);
  });

  test("mixed per-uses refs are allowed (AGENT-SPEC §1.4)", async () => {
    const lock = await resolveRefs(
      [
        { skill: "youtube", ref: "red-roster" },
        { skill: "youtube", ref: "loony-lionfish" },
      ],
      git,
    );
    expect(lock.entries.map((e) => e.sha)).toEqual(["bbbb111", "aaaa000"]);
  });

  test("unknown tag fails loudly", async () => {
    await expect(
      resolveRefs([{ skill: "youtube", ref: "no-such-tag" }], git),
    ).rejects.toThrow(RefResolutionError);
  });

  test("skill missing at ref fails loudly", async () => {
    await expect(
      resolveRefs([{ skill: "browser", ref: "loony-lionfish" }], git),
    ).rejects.toThrow(/does not exist at ref/);
  });
});

describe("verifyAgainstHead", () => {
  test("silent when installed tree matches the lock", async () => {
    const lock = await resolveRefs(
      [{ skill: "youtube", ref: "red-roster" }],
      git,
    );
    expect(await verifyAgainstHead(lock, git)).toEqual([]);
  });

  test("warns (never throws) when the installed tree drifted", async () => {
    const lock = await resolveRefs(
      [{ skill: "youtube", ref: "loony-lionfish" }],
      git,
    );
    const warnings = await verifyAgainstHead(lock, git);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("loony-lionfish");
  });
});

describe("lockfile round-trip", () => {
  test("serialize → parse is stable and deterministic", async () => {
    const lock = await resolveRefs(
      [
        { skill: "youtube", ref: "red-roster" },
        { skill: "browser", ref: "red-roster" },
      ],
      git,
    );
    const text = serializeLockfile(lock);
    expect(parseLockfile(text)).toEqual(lock);
    expect(serializeLockfile(parseLockfile(text))).toBe(text);
  });

  test("rejects malformed lockfiles", () => {
    expect(() => parseLockfile(`{"version":2,"entries":[]}`)).toThrow(
      RefResolutionError,
    );
    expect(() =>
      parseLockfile(`{"version":1,"entries":[{"skill":"x"}]}`)
    ).toThrow(/missing/);
  });

  test("pack members pin the pack tree via treePathOf", async () => {
    const packGit = fakeGit({
      "red-roster": "aaaa000",
      "red-roster:src/skills/web": "tree-web-aaa",
    });
    const lock = await resolveRefs(
      [{ skill: "browser", ref: "red-roster" }],
      packGit,
      () => "src/skills/web",
    );
    expect(lock.entries[0]).toEqual({
      skill: "browser",
      ref: "red-roster",
      sha: "aaaa000",
      path: "src/skills/web",
      tree: "tree-web-aaa",
    });
  });
});
