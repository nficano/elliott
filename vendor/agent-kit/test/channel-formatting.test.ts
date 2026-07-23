import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import {
  channelFormattingTool,
  documentedChannels,
  formattingGuide,
} from "../src/channels/formatting.js";
import type { ToolCtx } from "../src/core/agent/types.js";

const ctx = {} as ToolCtx;

function mustBuild(channels: readonly string[]) {
  const tool = channelFormattingTool(channels);
  if (!tool) throw new Error("expected channel_formatting tool");
  return tool;
}

describe("formatting guides", () => {
  test("slack and telegram ship guides; others don't", () => {
    expect(documentedChannels()).toEqual(["slack", "telegram"]);
    expect(formattingGuide("slack")).toContain("mrkdwn");
    expect(formattingGuide("slack")).toContain("Block Kit");
    expect(formattingGuide("telegram")).toContain("MessageEntity");
    expect(formattingGuide("telegram")).toContain("MarkdownV2");
    expect(formattingGuide("imessage")).toBeUndefined();
  });

  test("guides warn against standard markdown", () => {
    expect(formattingGuide("slack")).toContain("NOT standard Markdown");
    expect(formattingGuide("telegram")).toContain("GitHub-style markdown");
  });
});

describe("channel_formatting core tool", () => {
  test("absent when no documented channel is enabled", () => {
    expect(channelFormattingTool([])).toBeUndefined();
    expect(channelFormattingTool(["imessage"])).toBeUndefined();
  });

  test("schema only offers enabled documented channels", () => {
    const tool = mustBuild(["telegram", "imessage"]);
    expect(JSON.stringify(tool.parameters)).toContain("telegram");
    expect(JSON.stringify(tool.parameters)).not.toContain("slack");
  });

  test("returns the full guide for an enabled channel", async () => {
    const tool = mustBuild(["slack", "telegram"]);
    const out = await Effect.runPromise(
      tool.execute({ channel: "slack" }, ctx),
    );
    expect(out).toContain("Never emit **bold**");
    const rejected = await Effect.runPromise(
      tool.execute({ channel: "imessage" }, ctx).pipe(
        Effect.match({ onSuccess: () => "ok", onFailure: (e) => e.message }),
      ),
    );
    expect(rejected).toContain("invalid arguments");
  });
});
