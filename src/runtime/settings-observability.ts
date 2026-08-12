import { optionalStringAt, valueAt } from "./settings";
import type { GlitchTipSettings } from "./types";

// Zero-wiring default: with error reporting on but no operator DSN, the reporter
// posts to the bundled collector companion. The companion is a loopback sidecar
// (deploy/compose.glitchtip.yml), so the address mirrors the evaluator
// companions' 127.0.0.1:90xx convention. "elliott" is a non-secret public-key
// placeholder and "1" the project id; the collector accepts any key. When the
// companion is absent the sink simply drops — nothing crashes.
const DEFAULT_GLITCHTIP_COLLECTOR_DSN = "http://elliott@127.0.0.1:9080/1";

// A default-on flag is disabled only by an explicitly falsy value. Recognize
// the boolean `false`, the number `0` (YAML `enabled: 0` parses to a number),
// and the common YAML-ish falsy spellings ("false", "no", "off", "0", any
// case/whitespace) so any of them disables outbound reporting instead of
// silently failing open. Any other value keeps the default (on).
const GLITCHTIP_DISABLE_VALUES: ReadonlySet<string> = new Set([
  "false",
  "no",
  "off",
  "0",
]);

const glitchtipDisabled = (value: unknown): boolean => {
  if (value === false || value === 0) return true;
  if (typeof value !== "string") return false;
  return GLITCHTIP_DISABLE_VALUES.has(value.trim().toLowerCase());
};

// Error reporting is on by default and needs no setup step: absent config — or
// any value other than an explicitly falsy `enabled` — keeps it on. DSN
// precedence: an explicit config `dsn` wins, else the `ELLIOTT_GLITCHTIP_DSN`
// environment override (read at the config boundary and passed in), else the
// bundled collector companion — so error visibility works with zero wiring,
// points at your own Sentry/GlitchTip when either is set, and a falsy `enabled`
// stays console-only. The DSN never enters a captured error payload — only the
// POST target and auth header.
export const optionalGlitchTip = (
  value: unknown,
  envDsn?: string,
): { readonly glitchtip?: GlitchTipSettings; } => {
  if (
    glitchtipDisabled(valueAt(value, ["observability", "glitchtip", "enabled"]))
  ) {
    return {};
  }
  const envOverride = envDsn !== undefined && envDsn.length > 0
    ? envDsn
    : undefined;
  const dsn = optionalStringAt(value, ["observability", "glitchtip", "dsn"])
    ?? envOverride
    ?? DEFAULT_GLITCHTIP_COLLECTOR_DSN;
  return { glitchtip: { dsn } };
};
