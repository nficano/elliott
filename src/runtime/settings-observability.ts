import { valueAt } from "./settings";
import type { GlitchTipSettings } from "./types";

// Zero-wiring default: with error reporting on but no operator DSN, the reporter
// posts to the bundled collector companion. The companion is a loopback sidecar
// (deploy/compose.glitchtip.yml), so the address mirrors the evaluator
// companions' 127.0.0.1:90xx convention. "elliott" is a non-secret public-key
// placeholder and "1" the project id; the collector accepts any key. When the
// companion is absent the sink simply drops — nothing crashes.
const DEFAULT_GLITCHTIP_COLLECTOR_DSN = "http://elliott@127.0.0.1:9080/1";

// The `enabled` flag is parsed as a strict boolean by enumerating the GOOD
// (recognized) spellings rather than blocklisting bad ones — a typo must not
// silently fail open to outbound reporting. Absent (or null) keeps the default
// (on); a recognized truthy/falsy value sets it; anything else is a
// configuration error, thrown loudly, so a malformed flag neither enables nor
// silently disables reporting by accident.
const GLITCHTIP_ENABLE_VALUES: ReadonlySet<string> = new Set([
  "true",
  "yes",
  "on",
  "1",
]);
const GLITCHTIP_DISABLE_VALUES: ReadonlySet<string> = new Set([
  "false",
  "no",
  "off",
  "0",
]);

const glitchtipEnabled = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (GLITCHTIP_ENABLE_VALUES.has(normalized)) return true;
    if (GLITCHTIP_DISABLE_VALUES.has(normalized)) return false;
  }
  throw new Error(
    "observability.glitchtip.enabled must be true or false",
  );
};

// Error reporting is on by default and needs no setup step: an absent
// `observability.glitchtip` block keeps it on. DSN precedence: an explicit
// config `dsn` wins, else the `ELLIOTT_GLITCHTIP_DSN` environment override (read
// at the config boundary and passed in), else the bundled collector companion —
// so error visibility works with zero wiring, points at your own Sentry/GlitchTip
// when either is set, and a falsy `enabled` stays console-only. The DSN never
// enters a captured error payload — only the POST target and auth header.
export const optionalGlitchTip = (
  value: unknown,
  envDsn?: string,
): { readonly glitchtip?: GlitchTipSettings; } => {
  if (
    !glitchtipEnabled(valueAt(value, ["observability", "glitchtip", "enabled"]))
  ) {
    return {};
  }
  const configuredDsn = explicitDsn(
    valueAt(value, ["observability", "glitchtip", "dsn"]),
  );
  const envOverride = envDsn !== undefined && envDsn.length > 0
    ? envDsn
    : undefined;
  const dsn = configuredDsn ?? envOverride ?? DEFAULT_GLITCHTIP_COLLECTOR_DSN;
  return { glitchtip: { dsn } };
};

// A present operator `dsn` must be a non-empty string. Absent -> undefined (fall
// through to env/default). Present-but-malformed (a number, object, or an empty/
// whitespace string) is a configuration error, thrown loudly, rather than being
// silently ignored and routed to the bundled collector.
const explicitDsn = (raw: unknown): string | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(
      "observability.glitchtip.dsn must be a non-empty string",
    );
  }
  return raw;
};
