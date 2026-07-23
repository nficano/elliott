/**
 * Minimal semver + range matching for in-repo versioning (CAPABILITIES-TDD §7).
 * The useful subset only — exact, `^`, `~`, bare major (`2`, `2.x`), `>=`, `*` —
 * no npm dependency, no prerelease/build metadata.
 */
import type { Semver } from "./types.js";

const MAX_SEMVER_PARTS = 3;

/** Tolerant parse: `1` → 1.0.0, `1.2` → 1.2.0. Null on anything non-numeric. */
export function parseSemver(v: string): Semver | null {
  const parts = v.trim().split(".");
  if (
    parts.length > MAX_SEMVER_PARTS
    || parts.some((part) => !isNumeric(part))
  ) {
    return null;
  }
  return {
    major: Number(parts[0]),
    minor: Number(parts[1] ?? 0),
    patch: Number(parts[2] ?? 0),
  };
}

export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;
  if (r.startsWith(">=")) return satisfiesMinimum(v, r);
  if (r.startsWith("^")) return satisfiesCaret(v, r);
  if (r.startsWith("~")) return satisfiesTilde(v, r);
  const bareMajor = parseBareMajor(r);
  if (bareMajor !== undefined) return v.major === bareMajor;
  const exact = parseSemver(r);
  return exact !== null && compareSemver(v, exact) === 0;
}

function satisfiesMinimum(version: Semver, range: string): boolean {
  const base = parseSemver(range.slice(2));
  return base !== null && compareSemver(version, base) >= 0;
}

function satisfiesCaret(version: Semver, range: string): boolean {
  const base = parseSemver(range.slice(1));
  if (!base || compareSemver(version, base) < 0) return false;
  return base.major > 0
    ? version.major === base.major
    : version.major === 0 && version.minor === base.minor;
}

function satisfiesTilde(version: Semver, range: string): boolean {
  const base = parseSemver(range.slice(1));
  return Boolean(
    base
      && compareSemver(version, base) >= 0
      && version.major === base.major
      && version.minor === base.minor,
  );
}

function parseBareMajor(range: string): number | undefined {
  const parts = range.split(".");
  if (parts.length === 1 && isNumeric(parts[0]!)) return Number(parts[0]);
  if (
    parts.length === 2
    && isNumeric(parts[0]!)
    && (parts[1] === "x" || parts[1] === "*")
  ) {
    return Number(parts[0]);
  }
  return undefined;
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

/** Highest version (by semver order) satisfying the range, or undefined. */
export function highestSatisfying(
  versions: readonly string[],
  range: string,
): string | undefined {
  let best: { raw: string; parsed: Semver; } | undefined;
  for (const raw of versions) {
    const parsed = parseSemver(raw);
    if (!parsed || !satisfies(raw, range)) continue;
    if (!best || compareSemver(parsed, best.parsed) > 0) best = { raw, parsed };
  }
  return best?.raw;
}
