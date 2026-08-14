import path from "node:path";
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

const NO_REGISTRATION_MESSAGE =
  "did not load: no register() entrypoint or registration produced";
// A skill whose register() threw. The exception TEXT is never carried into the
// report (it is untrusted and may echo a credential), so the doctor states the
// fact it derived — the registration failed — and nothing the skill authored.
const REGISTER_FAILED_MESSAGE = "register() failed during startup";

// Classify one package from what the real loader observed plus its manifest gate.
// `threw` is whether register() reported an error (never the message); `secretRefs`
// are the secret:// references the manifest declares; `bundled` is whether the
// package is framework-authored (its manifest is trusted enough to echo those
// references) rather than an untrusted agent-local skill.
//
// A package that produced no registration at all (registered === false) is an
// error, not an expected gate miss: it either threw or exposed no entrypoint. A
// genuine gate miss always still registers — the skill imports, its register()
// runs and returns no bindings — so the two are distinct, and a package that never
// loaded is surfaced, not hidden as skipped.
export const classifyOutcome = (
  view: SkillPackageView,
  observed: {
    readonly threw: boolean;
    readonly secretRefs: readonly string[];
    readonly bundled: boolean;
  },
): DoctorSkillOutcome => {
  const { threw, secretRefs, bundled } = observed;
  const rawGateText = gateTextOf(view);
  const rawGate = parseGate(rawGateText);
  // An agent-local manifest is untrusted text end to end, not just under
  // `secret.use`. Its `metadata.name` and its `spec.topology.gate` are printed by
  // the report as readily as its references, so withholding only the references
  // left two fields a credential could ride in. For an untrusted package the
  // report states what the framework DERIVED — the gate's kind, parsed by this
  // repo's own grammar, and the directory the loader found the package in — and
  // none of the strings the manifest author wrote. The identifier tail is dropped
  // with the raw text: `secret:api` and `secret:sk-live-…` are indistinguishable
  // in shape, so nothing structural could keep one and drop the other.
  const gate = bundled ? rawGate : { kind: rawGate.kind };
  const gateText = bundled ? rawGateText : rawGate.kind;
  const bindings = view.bindings;
  const base = {
    name: bundled ? view.name : path.basename(view.directory),
    kind: view.kind,
    gate,
    gateText,
    // Only a bundled (framework-authored, trusted) manifest's references are
    // carried for display; an agent-local manifest's are withheld so a credential
    // smuggled behind a `secret://` prefix cannot reach the printed report.
    secretRefs: bundled ? secretRefs : [],
    bindings,
  } as const;
  if (!view.registered) {
    return {
      ...base,
      status: "error",
      needsVendorKey: false,
      error: threw ? REGISTER_FAILED_MESSAGE : NO_REGISTRATION_MESSAGE,
    };
  }
  if (totalBindings(bindings) > 0) {
    return { ...base, status: "ran", needsVendorKey: false };
  }
  // A skill needs a vendor key when its gate is a secret OR it declares any
  // secret reference — a config-gated skill (gateway-slack, gated on
  // channels.slack.enabled) that also requires `secret://gateways/slack` belongs
  // in the vendor-key list, not just the skipped list.
  return {
    ...base,
    status: "skipped",
    needsVendorKey: gate.kind === "secret" || secretRefs.length > 0,
  };
};
