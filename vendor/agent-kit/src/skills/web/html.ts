export function stripHtml(html: string): string {
  return stripTags(
    removeElementBlocks(removeElementBlocks(html, "script"), "style"),
  )
    .replaceAll(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = html.indexOf("<", cursor);
    if (start === -1) return output + html.slice(cursor);
    const end = html.indexOf(">", start + 1);
    if (end === -1) return output + html.slice(cursor);
    output += `${html.slice(cursor, start)} `;
    cursor = end + 1;
  }
}

function removeElementBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let cursor = 0;
  let output = "";
  for (;;) {
    const start = lower.indexOf(open, cursor);
    if (start === -1) return output + html.slice(cursor);
    const openEnd = lower.indexOf(">", start + open.length);
    const end = openEnd === -1 ? -1 : lower.indexOf(close, openEnd + 1);
    if (end === -1) return output + html.slice(cursor);
    output += `${html.slice(cursor, start)} `;
    cursor = end + close.length;
  }
}
