/**
 * Channel-adapter delivery contract (§20): the loop emits plain text; the
 * adapter splits + escapes. Splitting prefers paragraph, then line, then hard
 * boundaries so a chunk never lands mid-word when avoidable.
 */
const PREFERRED_BREAK_RATIO = 0.5;

export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * PREFERRED_BREAK_RATIO) {
      cut = rest.lastIndexOf("\n", limit);
    }
    if (cut < limit * PREFERRED_BREAK_RATIO) cut = rest.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Telegram MarkdownV2 reserved-character escaping (per-channel entity escaping, §20). */
export function escapeTelegramMarkdown(text: string): string {
  return text.replaceAll(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

/**
 * Slack mrkdwn entity escaping (§20): only `&`, `<`, `>` are special in message
 * text — escaping them keeps literal angle brackets/ampersands from being read
 * as links/entities while leaving `*bold*`/`` `code` `` intact. `&` must go first.
 */
export function escapeSlackText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
