import { isJsonRecord } from "../providers/http";
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

// Whether a raw `enabled` value EXPLICITLY disables glitchtip. Used at the config
// boundary to decide, before reference resolution, whether the (unused) dsn can
// be dropped so an unresolvable ${…} reference under a turned-off feature cannot
// abort boot. A malformed value is not "disabled" — it is kept so optionalGlitchTip
// surfaces the same loud error it would otherwise; only an explicit off short-
// circuits.
export const glitchtipExplicitlyDisabled = (value: unknown): boolean => {
  try {
    return !glitchtipEnabled(value);
  } catch {
    return false;
  }
};

const envOrDefaultDsn = (envDsn?: string): string =>
  envDsn !== undefined && envDsn.length > 0
    ? envDsn
    : DEFAULT_GLITCHTIP_COLLECTOR_DSN;

// Error reporting is on by default and needs no setup step. The
// `observability.glitchtip` block may be:
//   - absent            -> on, targeting the env/default collector.
//   - a SCALAR flag      -> the block itself acts as `enabled`
//                          (`glitchtip: false` disables; `glitchtip: true`
//                          enables the default collector). A present-but-
//                          unparseable scalar (`glitchtip: 42`) THROWS — it must
//                          never be treated as absent and silently fail open to
//                          outbound reporting.
//   - an OBJECT          -> `{ enabled?, dsn? }` with the usual precedence.
// DSN precedence (object form): an explicit `dsn` wins, else the
// `ELLIOTT_GLITCHTIP_DSN` env override, else the bundled collector companion. The
// DSN never enters a captured error payload — only the POST target/auth header.
export const optionalGlitchTip = (
  value: unknown,
  envDsn?: string,
): { readonly glitchtip?: GlitchTipSettings; } => {
  const block = valueAt(value, ["observability", "glitchtip"]);
  if (block !== undefined && !isJsonRecord(block)) {
    return glitchtipEnabled(block)
      ? { glitchtip: { dsn: envOrDefaultDsn(envDsn) } }
      : {};
  }
  const enabled = isJsonRecord(block) ? block["enabled"] : undefined;
  if (!glitchtipEnabled(enabled)) return {};
  const configuredDsn = explicitDsn(
    isJsonRecord(block) ? block["dsn"] : undefined,
  );
  return { glitchtip: { dsn: configuredDsn ?? envOrDefaultDsn(envDsn) } };
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
