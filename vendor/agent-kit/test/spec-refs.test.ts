import { describe, expect, test } from "bun:test";
import {
  parseUses,
  toolCandidates,
  UsesParseError,
} from "../src/host/spec/refs.js";

describe("parseUses", () => {
  test("skill@ref", () => {
    expect(parseUses("youtube@red-roster")).toEqual({
      kind: "registry",
      skill: "youtube",
      ref: "red-roster",
    });
  });

  test("skill/op@ref", () => {
    expect(parseUses("youtube/channel-uploads@red-roster")).toEqual({
      kind: "registry",
      skill: "youtube",
      op: "channel-uploads",
      ref: "red-roster",
    });
  });

  test("ref is optional (dev rides the installed tree)", () => {
    expect(parseUses("github/draft-pr")).toEqual({
      kind: "registry",
      skill: "github",
      op: "draft-pr",
    });
  });

  test("local path → id is the basename, no ref allowed", () => {
    expect(parseUses("./skills/pakman-latest-episode")).toEqual({
      kind: "local",
      path: "./skills/pakman-latest-episode",
      id: "pakman-latest-episode",
    });
    expect(() => parseUses("./skills/x@red-roster")).toThrow(UsesParseError);
  });

  test("rejects malformed refs", () => {
    expect(() => parseUses("")).toThrow(UsesParseError);
    expect(() => parseUses("a/b/c@tag")).toThrow(UsesParseError);
    expect(() => parseUses("youtube@")).toThrow(UsesParseError);
    expect(() => parseUses("Not-Kebab@tag")).toThrow(UsesParseError);
  });
});

describe("toolCandidates", () => {
  test("namespaced first, bare op second", () => {
    expect(toolCandidates("youtube", "channel-uploads")).toEqual([
      "youtube_channel_uploads",
      "channel_uploads",
    ]);
    expect(toolCandidates("github", "draft-pr")).toEqual([
      "github_draft_pr",
      "draft_pr",
    ]);
  });
});
