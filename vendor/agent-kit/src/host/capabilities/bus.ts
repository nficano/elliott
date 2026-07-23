import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  capabilityDepth,
  formatChain,
  hasHop,
  MAX_CAPABILITY_DEPTH,
  pushHop,
} from "../../core/agent/chain.js";
import type { CallChain } from "../../core/agent/types.js";
import { formatSchemaError } from "../../core/errors.js";
import { CapabilityError } from "./errors.js";
import { tryProvider } from "./provider.js";
import type {
  CapabilityBusDeps,
  CapabilityContract,
  CapabilityCtx,
  CapabilityFailure,
  CapabilityInvoker,
  CapabilitySelection,
  InvocationRequest,
  Preparation,
  PreparedInvocation,
} from "./types.js";

/**
 * The capability bus (CAPABILITIES-TDD §3.5) — the one path every capability
 * call takes, on Effect's typed error channel. Input and output are decoded
 * against the contract on BOTH sides (what makes providers interchangeable);
 * provider selection + fallback order come from config; nothing is available
 * unless configured (opt-in, §5). Every hop lands on the call chain.
 */
export function makeCapabilityBus(deps: CapabilityBusDeps): CapabilityInvoker {
  return {
    available(ref: string): boolean {
      return Boolean(deps.selections[ref]);
    },
    invoke(ref, input, partialCtx): Effect.Effect<unknown, CapabilityError> {
      return invokeCapability(deps, {
        ref,
        input,
        ...(partialCtx && { partialCtx }),
      });
    },
  };
}

function invokeCapability(
  deps: CapabilityBusDeps,
  request: InvocationRequest,
): Effect.Effect<unknown, CapabilityError> {
  const prepared = prepareInvocation(deps, request);
  return prepared.ok
    ? invokeProviders(deps, request.ref, prepared.value)
    : Effect.fail(prepared.error);
}

function prepareInvocation(
  deps: CapabilityBusDeps,
  request: InvocationRequest,
): Preparation {
  const { ref, input, partialCtx } = request;
  const baseChain: CallChain = partialCtx?.chain ?? [];
  const contract = deps.catalog.get(ref);
  if (!contract) {
    return preparationError("unknown", `no contract '${ref}'`, baseChain);
  }
  const selection = deps.selections[ref];
  if (!selection) {
    return preparationError(
      "unconfigured",
      `capability '${ref}' has no configured provider`,
      baseChain,
    );
  }
  const chainProblem = validateChain(baseChain, ref);
  if (chainProblem) return { ok: false, error: chainProblem };
  return decodeInvocation({
    contract,
    selection,
    ref,
    input,
    ...(partialCtx && { partialCtx }),
    baseChain,
  });
}

function validateChain(
  chain: CallChain,
  ref: string,
): CapabilityError | undefined {
  if (hasHop(chain, "capability", ref)) {
    return capabilityError("cycle", `'${ref}' re-entered itself`, chain);
  }
  if (capabilityDepth(chain) >= MAX_CAPABILITY_DEPTH) {
    return capabilityError(
      "depth",
      `capability nesting exceeds ${MAX_CAPABILITY_DEPTH}`,
      chain,
    );
  }
  return undefined;
}

function decodeInvocation(options: {
  readonly contract: CapabilityContract;
  readonly selection: CapabilitySelection;
  readonly ref: string;
  readonly input: unknown;
  readonly partialCtx?: Partial<CapabilityCtx>;
  readonly baseChain: CallChain;
}): Preparation {
  const decoded = Schema.decodeUnknownResult(options.contract.input)(
    options.input,
  );
  if (Result.isFailure(decoded)) {
    return preparationError(
      "bad_input",
      `invalid input for '${options.ref}': ${
        formatSchemaError(decoded.failure)
      }`,
      options.baseChain,
    );
  }
  const chain = pushHop(options.baseChain, {
    kind: "capability",
    ref: options.ref,
  });
  const ctx: CapabilityCtx = {
    chain,
    origin: options.partialCtx?.origin ?? "internal",
    ...(options.partialCtx?.signal && { signal: options.partialCtx.signal }),
  };
  void formatChain;
  return {
    ok: true,
    value: {
      selection: options.selection,
      decodedInput: decoded.success,
      chain,
      ctx,
    },
  };
}

function invokeProviders(
  deps: CapabilityBusDeps,
  ref: string,
  prepared: PreparedInvocation,
): Effect.Effect<unknown, CapabilityError> {
  return Effect.gen(function*() {
    let lastSoft: unknown;
    const providers = [
      prepared.selection.provider,
      ...(prepared.selection.fallback ?? []),
    ];
    for (const id of providers) {
      const outcome = yield* Effect.result(
        tryProvider({
          deps,
          id,
          ref,
          input: prepared.decodedInput,
          ctx: prepared.ctx,
        }),
      );
      if (Result.isSuccess(outcome)) return outcome.success;
      if (outcome.failure.kind === "hard") {
        return yield* Effect.fail(outcome.failure.error);
      }
      lastSoft = outcome.failure.cause;
    }
    return yield* Effect.fail(
      makeCapabilityError({
        reason: "failed",
        detail: `all providers for '${ref}' failed or were unavailable`,
        chain: prepared.chain,
        cause: lastSoft,
      }),
    );
  });
}

function preparationError(
  reason: CapabilityFailure,
  detail: string,
  chain: CallChain,
): Preparation {
  return { ok: false, error: makeCapabilityError({ reason, detail, chain }) };
}

function capabilityError(
  reason: CapabilityFailure,
  detail: string,
  chain: CallChain,
): CapabilityError {
  return makeCapabilityError({ reason, detail, chain });
}

function makeCapabilityError(options: {
  readonly reason: CapabilityFailure;
  readonly detail: string;
  readonly chain: CallChain;
  readonly cause?: unknown;
}): CapabilityError {
  return new CapabilityError(options);
}

/**
 * The uniform degrade for model-facing tools (TDD §4.5): an unconfigured or
 * failed capability becomes DATA the model can narrate, not an exception —
 * the prior art's `{mode:"unavailable", note}` discipline, in one place.
 */
export function degradeForModel(error: CapabilityError): string {
  const mode = error.reason === "unconfigured" || error.reason === "unknown"
    ? "unavailable"
    : "failed";
  return JSON.stringify({ mode, note: error.message });
}
