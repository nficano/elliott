/**
 * Anchored edits + path fencing (CAPABILITIES-TDD §9.4) — the generic
 * change-application core behind the github skill's draft PRs and the §13
 * self-improve PR gate. Fail-closed by construction: an anchor that matches
 * zero times or more than once ABORTS THE WHOLE SET, so a fabricated/ambiguous
 * edit can never land partially.
 */
import type { AnchoredEdit, EditResult } from "./types.js";

/** Apply all edits or none. Edits apply sequentially — later anchors see earlier results. */
export function applyAnchoredEdits(
  content: string,
  edits: readonly AnchoredEdit[],
): EditResult {
  let out = content;
  for (const [i, edit] of edits.entries()) {
    const e = edit;
    const match = findOccurrence(out, e.find);
    if (match.count === 0) {
      return { ok: false, failure: { kind: "absent", index: i } };
    }
    if (match.count > 1) {
      return {
        ok: false,
        failure: { kind: "ambiguous", index: i, count: match.count },
      };
    }
    out = out.slice(0, match.index) + e.replace
      + out.slice(match.index + e.find.length);
  }
  return { ok: true, content: out };
}

function findOccurrence(
  haystack: string,
  needle: string,
): { index: number; count: number; } {
  if (!needle) return { index: -1, count: 0 };
  const index = haystack.indexOf(needle);
  if (index === -1) return { index, count: 0 };
  let count = 0;
  let at = index;
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return { index, count };
}

/**
 * Path fencing (the write-surface allowlist): every path must be relative,
 * `..`-free, and under one of the allowed prefixes. Returns the offenders;
 * empty = all clear. An empty allowlist fences EVERYTHING out (fail closed).
 */
export function fencePaths(
  paths: readonly string[],
  allowedPrefixes: readonly string[],
): string[] {
  return paths.filter((p) => {
    if (p.startsWith("/") || p.includes("..") || p.includes("\\")) return true;
    return allowedPrefixes.every((prefix) =>
      !(p === prefix || p.startsWith(ensureSlash(prefix)))
    );
  });
}

function ensureSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}
