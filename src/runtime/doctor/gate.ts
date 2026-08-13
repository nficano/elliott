import { isJsonRecord } from "../../providers/http";
import type { SkillPackageView } from "../skills/types";
import type { DoctorGate, DoctorSkillOutcome } from "./types";

// The `always` sentinel — a gate that waits on nothing.
const ALWAYS = "always";
const SECRET_PREFIX = "secret:";
const CONFIG_PREFIX = "config:";
const CONFIG_BARE = "config";

// Read the raw spec.topology.gate string off a loaded package. Absent or
// non-string blocks yield `always`, matching the loader's own tolerance for a
// missing topology block.
export const gateTextOf = (view: SkillPackageView): string => {
  const topology = view.topology;
  if (!isJsonRecord(topology)) return ALWAYS;
  const gate = topology["gate"];
  return typeof gate === "string" ? gate : ALWAYS;
};

// Parse a gate string into its kind and the key/flag it waits on. Unknown
// non-empty shapes are surfaced as config gates carrying the whole string
// rather than silently collapsed to `always`, so a new gate grammar cannot make
// a dormant skill read as active.
export const parseGate = (raw: string): DoctorGate => {
  if (raw === ALWAYS || raw.length === 0) return { kind: "always" };
  if (raw.startsWith(SECRET_PREFIX)) {
    return { kind: "secret", identifier: raw.slice(SECRET_PREFIX.length) };
  }
  if (raw.startsWith(CONFIG_PREFIX)) {
    return { kind: "config", identifier: raw.slice(CONFIG_PREFIX.length) };
  }
  if (raw === CONFIG_BARE) return { kind: "config" };
  return { kind: "config", identifier: raw };
};

const totalBindings = (bindings: Readonly<Record<string, number>>): number =>
  Object.values(bindings).reduce((sum, value) => sum + value, 0);

// Classify one package from what the real loader observed plus its manifest
// gate. `errorMessage` is the message the loader captured when register() threw
// (undefined otherwise); `secretRefs` are the secret:// URIs the manifest
// declares.
export const classifyOutcome = (
  view: SkillPackageView,
  errorMessage: string | undefined,
  secretRefs: readonly string[],
): DoctorSkillOutcome => {
  const gateText = gateTextOf(view);
  const gate = parseGate(gateText);
  const bindings = view.bindings;
  const base = {
    name: view.name,
    kind: view.kind,
    gate,
    gateText,
    secretRefs,
    bindings,
  } as const;
  if (!view.registered && errorMessage !== undefined) {
    return {
      ...base,
      status: "error",
      needsVendorKey: false,
      error: errorMessage,
    };
  }
  if (view.registered && totalBindings(bindings) > 0) {
    return { ...base, status: "ran", needsVendorKey: false };
  }
  const needsVendorKey = gate.kind === "secret";
  return {
    ...base,
    status: "skipped",
    needsVendorKey,
    ...(needsVendorKey && gate.identifier !== undefined
      && { missingKey: gate.identifier }),
  };
};
