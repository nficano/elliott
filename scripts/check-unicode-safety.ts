#!/usr/bin/env bun
/**
 * Hidden-Unicode gate (Trojan Source defense). Scans every git-tracked text
 * file for bidirectional control characters (CVE-2021-42574: reorder rendered
 * source so reviewed code differs from compiled code) and zero-width
 * characters (invisible payloads in source, prompts, or configs). The tree is
 * expected to be completely clean; add an exemption here only with a comment
 * defending it.
 *
 * Patterns are compiled from hex code-point specs so this file stays pure
 * ASCII — a literal occurrence would trip the scan itself.
 */

import process from "node:process";

const HEX_RADIX = 16;
const HEX_PAD = 4;

const escapeHex = (hex: string): string => String.raw`\u{${hex}}`;

// Spec: space-separated code points or FROM-TO ranges, in hex.
const compile = (spec: string): RegExp => {
  const parts = spec.split(" ").map((token) => {
    const bounds = token.split("-");
    const from = bounds[0] ?? "";
    const to = bounds[1];
    return to === undefined
      ? escapeHex(from)
      : `${escapeHex(from)}-${escapeHex(to)}`;
  });
  return new RegExp(`[${parts.join("")}]`, "gu");
};

// ALM, LRM/RLM, LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI.
const BIDI_CONTROLS = compile("061C 200E 200F 202A-202E 2066-2069");
// ZWSP/ZWNJ/ZWJ, word joiner, BOM/ZWNBSP.
const ZERO_WIDTH = compile("200B-200D 2060 FEFF");

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "zip",
  "gz",
  "tar",
  "wasm",
  "sqlite",
]);

const label = (character: string): string => {
  const codePoint = character.codePointAt(0) ?? 0;
  const hex = codePoint
    .toString(HEX_RADIX)
    .toUpperCase()
    .padStart(HEX_PAD, "0");
  return `U+${hex}`;
};

const isBinaryPath = (path: string): boolean => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
};

const trackedFiles = (): readonly string[] => {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    console.error("✗ unicode gate: git ls-files failed.");
    process.exit(1);
  }
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0 && !isBinaryPath(path));
};

const findingsIn = (
  line: string,
  pattern: RegExp,
  category: string,
): readonly string[] => {
  const matches: string[] = Array.from(
    line.matchAll(pattern),
    match => `column ${match.index + 1}: ${label(match[0])} (${category})`,
  );
  return matches;
};

const scanFile = async (path: string): Promise<readonly string[]> => {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return [];
  }
  const findings: string[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const hits = [
      ...findingsIn(line, BIDI_CONTROLS, "bidi control"),
      ...findingsIn(line, ZERO_WIDTH, "zero-width"),
    ];
    for (const hit of hits) {
      findings.push(`${path}:${index + 1} ${hit}`);
    }
  }
  return findings;
};

const allFindings: string[] = [];
for (const path of trackedFiles()) {
  allFindings.push(...await scanFile(path));
}

if (allFindings.length === 0) {
  console.log("✓ unicode gate: no bidi or zero-width characters in the tree.");
  process.exit(0);
}
console.error(
  "✗ unicode gate: hidden Unicode characters found (Trojan Source risk):",
);
for (const finding of allFindings) console.error(`  ${finding}`);
process.exit(1);
