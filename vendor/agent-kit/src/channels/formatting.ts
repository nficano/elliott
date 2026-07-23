import * as Schema from "effect/Schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { define } from "../core/agent/index.js";
import type { ToolDef } from "../core/agent/types.js";

/**
 * Per-channel formatting knowledge (§20 makes delivery mechanics a channel
 * concern; this is its model-facing half). Full guides live as git-authoritative
 * disk assets under channels/assets/ and are disclosed progressively (§10.1):
 * only the terse `channel_formatting` tool schema rides the cached prefix; a
 * guide's body costs tokens only on the turn that asks for it.
 */

const GUIDES: Record<string, string> = {
  slack: "./assets/slack-formatting.md",
  telegram: "./assets/telegram-formatting.md",
};

const cache = new Map<string, string>();

/** Channels that ship a formatting guide. */
export function documentedChannels(): string[] {
  return Object.keys(GUIDES).sort((a, b) => a.localeCompare(b));
}

/** Lazy-load a channel's formatting guide; undefined if none ships. */
export function formattingGuide(channel: string): string | undefined {
  const rel = GUIDES[channel];
  if (rel === undefined) return undefined;
  let text = cache.get(channel);
  if (text === undefined) {
    text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    cache.set(channel, text);
  }
  return text;
}

/**
 * The `channel_formatting` core tool, built only for enabled channels that
 * ship a guide; undefined when none do (the schema then costs nothing).
 */
export function channelFormattingTool(
  enabledChannels: readonly string[],
): ToolDef | undefined {
  const channels = documentedChannels().filter((c) =>
    enabledChannels.includes(c)
  );
  if (channels.length === 0) return undefined;
  return define({
    name: "channel_formatting",
    description:
      "Get the formatting rules for a delivery channel BEFORE composing styled output for it. "
      + "Slack mrkdwn and Telegram entities are NOT standard Markdown — **bold**, [links](url), "
      + "# headings, and tables render as literal noise there. Plain unstyled text needs no lookup.",
    schema: Schema.Struct({
      channel: Schema.Literals(channels as [string, ...string[]]),
    }),
    meta: {
      componentId: "channels",
      bundle: "comms",
      core: true,
      write: false,
    },
    run: async (args) => {
      const guide = formattingGuide(args.channel);
      return guide ?? JSON.stringify({
        error: `no formatting guide for channel "${args.channel}"`,
      });
    },
  });
}
