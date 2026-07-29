import { isJsonRecord } from "../../../../src/providers/http";
import type { SlackJson } from "./types";

export const ALLOWED_SLACK_EMOJI = [
  ":circle-error:",
  ":circle-sucess:",
  ":circle-upload:",
  ":circle-warn:",
  ":in-progress:",
  ":pr-close:",
  ":pr-merge:",
  ":pr-open:",
  ":ring-check:",
  ":ring-dot:",
  ":status-fail:",
  ":status-ok:",
  ":triangle-warn:",
] as const;

const ALLOWED = new Set<string>(ALLOWED_SLACK_EMOJI);
const MIN_SHORTCODE_LENGTH = 3;
const ASCII_DIGIT_START = 48;
const ASCII_DIGIT_END = 57;
const ASCII_LETTER_START = 97;
const ASCII_LETTER_END = 122;
const SUPPLEMENTAL_EMOJI_START = 126_976;
const SUPPLEMENTAL_EMOJI_END = 129_791;
const TECHNICAL_SYMBOL_START = 8960;
const TECHNICAL_SYMBOL_END = 9215;
const DINGBAT_START = 9728;
const DINGBAT_END = 10_239;
const ARROW_SYMBOL_START = 11_008;
const ARROW_SYMBOL_END = 11_263;
const ZERO_WIDTH_JOINER = 8205;
const KEYCAP_MARK = 8419;
const TEXT_VARIATION_SELECTOR = 65_038;
const EMOJI_VARIATION_SELECTOR = 65_039;
const DISPLAY_TEXT_KEYS = new Set([
  "accessibility_label",
  "alt_text",
  "loading_messages",
  "markdown_text",
  "message",
  "status",
  "text",
  "title",
]);

const SHORTCODE_REPLACEMENTS = new Map<string, string>([
  [":circle-success:", ":circle-sucess:"],
  [":heavy_check_mark:", ":status-ok:"],
  [":white_check_mark:", ":status-ok:"],
  [":x:", ":status-fail:"],
  [":warning:", ":triangle-warn:"],
  [":rocket:", ":circle-upload:"],
  [":hourglass_flowing_sand:", ":in-progress:"],
]);

const UNICODE_REPLACEMENTS = new Map<string, string>([
  ["✅", ":status-ok:"],
  ["✔️", ":status-ok:"],
  ["✔", ":status-ok:"],
  ["✓", ":status-ok:"],
  ["❌", ":status-fail:"],
  ["✖️", ":status-fail:"],
  ["✖", ":status-fail:"],
  ["✕", ":status-fail:"],
  ["⚠️", ":triangle-warn:"],
  ["⚠", ":triangle-warn:"],
  ["🚀", ":circle-upload:"],
  ["⏰", ":circle-warn:"],
]);

export const sanitizeSlackEmoji = (text: string): string => {
  let output = text;
  for (const [emoji, replacement] of UNICODE_REPLACEMENTS) {
    output = output.split(emoji).join(replacement);
  }
  return stripUnicodeEmoji(sanitizeShortcodes(output));
};

export const sanitizeSlackDisplayPayload = (value: SlackJson): SlackJson =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sanitizePayloadValue(item, DISPLAY_TEXT_KEYS.has(key)),
    ]),
  );

const sanitizePayloadValue = (
  value: unknown,
  displayText: boolean,
): unknown => {
  if (typeof value === "string") {
    return displayText ? sanitizeSlackEmoji(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayloadValue(item, displayText));
  }
  if (!isJsonRecord(value)) return value;
  return sanitizeSlackDisplayPayload(value);
};

export class SlackEmojiStreamFilter {
  #pending = "";

  push(
    fragment: string,
  ): { readonly text: string; readonly sourceLength: number; } {
    const combined = this.#pending + fragment;
    const hold = partialShortcodeStart(combined);
    const ready = hold === -1 ? combined : combined.slice(0, hold);
    this.#pending = hold === -1 ? "" : combined.slice(hold);
    return { text: sanitizeSlackEmoji(ready), sourceLength: ready.length };
  }

  finish(): { readonly text: string; readonly sourceLength: number; } {
    const ready = this.#pending;
    this.#pending = "";
    return { text: sanitizeSlackEmoji(ready), sourceLength: ready.length };
  }
}

const partialShortcodeStart = (value: string): number => {
  const last = value.lastIndexOf(":");
  if (last === -1) return -1;
  const tail = value.slice(last);
  if (!isPartialShortcode(tail)) return -1;
  if (tail !== ":") return last;
  const previous = value.lastIndexOf(":", last - 1);
  return previous !== -1 && isFullShortcode(value.slice(previous))
    ? -1
    : last;
};

const sanitizeShortcodes = (text: string): string => {
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf(":", cursor);
    if (open === -1) return output + text.slice(cursor);
    output += text.slice(cursor, open);
    const close = text.indexOf(":", open + 1);
    if (close === -1) return output + text.slice(open);
    const candidate = text.slice(open, close + 1);
    if (!isFullShortcode(candidate)) {
      output += ":";
      cursor = open + 1;
      continue;
    }
    const normalized = candidate.toLowerCase();
    output += ALLOWED.has(normalized)
      ? normalized
      : SHORTCODE_REPLACEMENTS.get(normalized) ?? "";
    cursor = close + 1;
  }
  return output;
};

const isFullShortcode = (value: string): boolean => {
  if (value.length < MIN_SHORTCODE_LENGTH || !value.endsWith(":")) {
    return false;
  }
  const name = value.slice(1, -1);
  if (name === "+1" || name === "-1") return true;
  return isAsciiLetter(name[0]) && [...name].every(isShortcodeCharacter);
};

const isPartialShortcode = (value: string): boolean => {
  if (!value.startsWith(":") || value.includes(":", 1)) return false;
  const name = value.slice(1);
  if (name.length === 0 || name === "+" || name === "-") return true;
  if (name === "+1" || name === "-1") return true;
  return isAsciiLetter(name[0]) && [...name].every(isShortcodeCharacter);
};

const isShortcodeCharacter = (value: string): boolean =>
  isAsciiLetter(value)
  || isAsciiDigit(value)
  || value === "_"
  || value === "+"
  || value === "-";

const isAsciiLetter = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const code = value.toLowerCase().charCodeAt(0);
  return code >= ASCII_LETTER_START && code <= ASCII_LETTER_END;
};

const isAsciiDigit = (value: string): boolean => {
  const code = value.charCodeAt(0);
  return code >= ASCII_DIGIT_START && code <= ASCII_DIGIT_END;
};

const stripUnicodeEmoji = (text: string): string =>
  [...text].filter((value) => {
    const code = value.codePointAt(0);
    return code === undefined || !isEmojiCodePoint(code);
  }).join("");

const isEmojiCodePoint = (code: number): boolean =>
  inRange(code, SUPPLEMENTAL_EMOJI_START, SUPPLEMENTAL_EMOJI_END)
  || inRange(code, TECHNICAL_SYMBOL_START, TECHNICAL_SYMBOL_END)
  || inRange(code, DINGBAT_START, DINGBAT_END)
  || inRange(code, ARROW_SYMBOL_START, ARROW_SYMBOL_END)
  || code === ZERO_WIDTH_JOINER
  || code === KEYCAP_MARK
  || code === TEXT_VARIATION_SELECTOR
  || code === EMOJI_VARIATION_SELECTOR;

const inRange = (value: number, start: number, end: number): boolean =>
  value >= start && value <= end;
