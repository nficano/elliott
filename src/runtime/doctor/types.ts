import type { BundledPackage } from "../../catalog/types";
import type { LoadedSkill, SkillContextSeed } from "../skills/types";
import type { RuntimeModelCompleter, RuntimeSettings } from "../types";

// What a bundled skill's register() did on a minimal-config boot:
//   ran     — registered at least one binding (tool/gateway/route/service).
//   skipped — registered but produced no bindings (its gate was unmet, e.g. a
//             missing vendor key); the boot continues, the skill stays dormant.
//   error   — register() threw; the package failed to load. A clean clone
//             should never produce this, so the harness treats it as a failure.
export type DoctorSkillStatus = "error" | "ran" | "skipped";

// A manifest's spec.topology.gate string, parsed. `always` gates never wait on
// anything; `secret:<id>` waits on a resolved secret (a vendor key); `config`
// waits on a config flag or value at `identifier`.
export interface DoctorGate {
  readonly kind: "always" | "config" | "secret";
  readonly identifier?: string;
}

export interface DoctorSkillOutcome {
  readonly name: string;
  readonly kind: string;
  readonly status: DoctorSkillStatus;
  readonly gate: DoctorGate;
  // The gate string verbatim from the manifest, for display and audit.
  readonly gateText: string;
  // Secret references the manifest declares (secret:// URIs from
  // spec.capabilities). The authoritative "what to set" pointer for a skipped,
  // secret-gated skill.
  readonly secretRefs: readonly string[];
  // A skipped skill whose gate is a secret needs a vendor key beyond the LLM
  // provider before it can activate. `missingKey` names that key.
  readonly needsVendorKey: boolean;
  readonly missingKey?: string;
  // Binding counts the real loader produced (0 across the board when skipped).
  readonly bindings: Readonly<Record<string, number>>;
  // A clean, single-line message when status is "error" (never a stack trace).
  readonly error?: string;
}

// The live LLM round-trip: the whole config→endpoint→wire→HTTP→decode path
// exercised against the configured provider with the operator's key.
export interface DoctorLlmProbe {
  readonly ok: boolean;
  readonly wire: string;
  readonly baseUrl: string;
  readonly model: string;
  // The model's reply on success (bounded).
  readonly reply?: string;
  // A clean, named failure message on failure — no raw stack trace.
  readonly error?: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly elapsedMilliseconds: number;
  // True when the run took longer than the cold-run budget. Informational: a
  // slow-but-successful run still passes.
  readonly coldRunBudgetExceeded: boolean;
  readonly skills: readonly DoctorSkillOutcome[];
  readonly llm: DoctorLlmProbe;
  // Every host contacted during the run, and any that breached the
  // LLM-endpoint-only egress allowlist. A non-empty violation list fails the run.
  readonly contactedHosts: readonly string[];
  readonly egressViolations: readonly string[];
  // Non-fatal notices (e.g. a skill's register() soft-reported through the
  // context without throwing).
  readonly warnings: readonly string[];
}

// The outcome of an egress-guarded region: the wrapped function's result plus
// the hosts it touched and the ones it was denied.
export interface DoctorEgressTrace<T> {
  readonly result: T;
  readonly contactedHosts: readonly string[];
  readonly violations: readonly string[];
}

// Injectable seams so the harness can be exercised offline. Production callers
// get the real loaders, the real model client, and a wall clock.
export interface DoctorDependencies {
  readonly loadPackages: (root: string) => Promise<readonly BundledPackage[]>;
  readonly register: (
    packages: readonly BundledPackage[],
    seed: SkillContextSeed,
  ) => Promise<readonly LoadedSkill[]>;
  readonly makeCompleter: (settings: RuntimeSettings) => RuntimeModelCompleter;
  readonly manifestSecrets: (directory: string) => Promise<readonly string[]>;
  readonly now: () => number;
}

export interface DoctorInput {
  readonly frameworkRoot: string;
  readonly settings: RuntimeSettings;
}

// One report a skill's register() emitted through SkillContext.report: the
// mechanism it was tagged with (skill:<name> when the loader caught a throw)
// and its clean message.
export interface CapturedReport {
  readonly mechanism: string;
  readonly message: string;
}

// The environment overlay the doctor applies before loading runtime settings,
// plus whether the model was defaulted. The overlay fills in the LLM trio when
// it can be derived from a lone vendor key (the convenience path); when the
// operator already exports explicit ELLIOTT_LLM_* — or configures a base_url —
// the overlay is empty and the config boundary validates and names any gap.
export interface DoctorEnvOverlay {
  readonly overlay: Readonly<Record<string, string>>;
  readonly modelDefaulted: boolean;
}

// A read-only view of the process environment, as the doctor's config
// resolution consumes it.
export type DoctorEnv = Readonly<Record<string, string | undefined>>;
