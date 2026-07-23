import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { CallChain } from "../../core/agent/types.js";
import type { Origin } from "../../core/types.js";
import type { Registry } from "../registry/types.js";
import type { ContractCatalog } from "./contracts.js";
import type { CapabilityError } from "./errors.js";

/**
 * Capability contracts (CAPABILITIES-TDD §3) — a named, versioned interface
 * (the `workflow_call` analog): input/output `effect/Schema`, no behavior. Skills
 * whose functionality overlaps register as PROVIDERS of a shared contract;
 * config (`capabilities.<ref>: {provider, fallback}`) selects who serves a ref.
 */
export interface CapabilityContract {
  /** kebab-case noun(-verb), e.g. "page-fetch" (§26.6). */
  readonly id: string;
  /** Interface major; the ref is `<id>@<major>`. Breaking io change bumps it. */
  readonly major: number;
  readonly description: string;
  // Contracts are decoded synchronously by the bus, so their schemas must not
  // require decoding services. The decoded value remains erased at this boundary.
  readonly input: Schema.Decoder<unknown>;
  readonly output: Schema.Decoder<unknown>;
  /** Dot-paths inside input to redact wherever input is sampled for debug. */
  readonly redact?: readonly string[];
}

export function refOf(c: Pick<CapabilityContract, "id" | "major">): string {
  return `${c.id}@${c.major}`;
}

/** Static provider declaration on a manifest (inspectable without code, §6). */
export interface ProviderDecl {
  readonly capability: string; // "page-fetch@1"
}

/** Per-invocation context handed to a provider. */
export interface CapabilityCtx {
  readonly chain: CallChain;
  /** Provenance of the triggering turn (§16); providers must not widen trust. */
  readonly origin: Origin;
  readonly signal?: AbortSignal;
}

/** The implementation a registrable returns from `activate()`. */
export interface ProviderImpl {
  readonly capability: string;
  /** Raw in/out — the bus validates both sides against the contract. */
  invoke(input: unknown, ctx: CapabilityCtx): Promise<unknown>;
}

export type CapabilityFailure =
  | "unknown" //        no such contract in the catalog
  | "unconfigured" //   no `capabilities.<ref>` selection → the DEGRADE error
  | "no_provider" //    selection names a missing/disabled/non-providing id
  | "bad_input" //      caller broke the contract (never retried/failed-over)
  | "bad_output" //     provider broke the contract
  | "depth" //          capability nesting beyond MAX_CAPABILITY_DEPTH
  | "cycle" //          a capability re-entered itself
  | "failed"; //        provider + all fallbacks failed

// ── capability bus (CAPABILITIES-TDD §3.5) — see bus.ts for the implementation ──

export interface CapabilitySelection {
  readonly provider: string;
  readonly fallback?: readonly string[];
}

export interface CapabilityInvoker {
  invoke(
    ref: string,
    input: unknown,
    ctx?: Partial<CapabilityCtx>,
  ): Effect.Effect<unknown, CapabilityError>;
  /** True when a selection exists for the ref (not a liveness check). */
  available(ref: string): boolean;
}

export interface ObsLike {
  recordError(
    tag: string,
    message: string,
    attrs?: Record<string, unknown>,
  ): void;
}

export interface CapabilityBusDeps {
  readonly catalog: ContractCatalog;
  readonly registry: Pick<Registry, "activate" | "get">;
  /** `capabilities:` config section, keyed by ref (verbatim, §26.6). */
  readonly selections: Readonly<Record<string, CapabilitySelection>>;
  readonly obs?: ObsLike;
}

/** A provider attempt fails either terminally (`hard`) or fall-over-able (`soft`). */
export type ProviderFailure =
  | { readonly kind: "hard"; readonly error: CapabilityError; }
  | { readonly kind: "soft"; readonly cause: unknown; };

export interface ProviderAttempt {
  readonly deps: CapabilityBusDeps;
  readonly id: string;
  readonly ref: string;
  readonly input: unknown;
  readonly ctx: CapabilityCtx;
}

export interface PreparedInvocation {
  readonly selection: CapabilitySelection;
  readonly decodedInput: unknown;
  readonly chain: CallChain;
  readonly ctx: CapabilityCtx;
}

export interface InvocationRequest {
  readonly ref: string;
  readonly input: unknown;
  readonly partialCtx?: Partial<CapabilityCtx>;
}

export type Preparation =
  | { readonly ok: true; readonly value: PreparedInvocation; }
  | { readonly ok: false; readonly error: CapabilityError; };
