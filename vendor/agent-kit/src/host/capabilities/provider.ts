import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { pushHop } from "../../core/agent/chain.js";
import type { CallChain } from "../../core/agent/types.js";
import { isTaggedError } from "../../core/errors.js";
import { CapabilityError } from "./errors.js";
import type {
  CapabilityContract,
  CapabilityCtx,
  ProviderAttempt,
  ProviderFailure,
  ProviderImpl,
} from "./types.js";

export type { ProviderAttempt } from "./types.js";

export function tryProvider(
  attempt: ProviderAttempt,
): Effect.Effect<unknown, ProviderFailure> {
  const { deps, id, ref, input, ctx } = attempt;
  const contract = deps.catalog.get(ref)!;
  return Effect.gen(function*() {
    const active = yield* Effect.tryPromise({
      try: () => deps.registry.activate(id),
      catch: (cause): ProviderFailure => ({ kind: "soft", cause }),
    });
    const impl = (active.providers ?? []).find((item) =>
      item.capability === ref
    );
    if (!impl) {
      return yield* Effect.fail<ProviderFailure>({
        kind: "soft",
        cause: new Error(`'${id}' does not provide '${ref}'`),
      });
    }
    const version = deps.registry.get(id)?.registrable.manifest.version ?? "?";
    const chain = pushHop(ctx.chain, {
      kind: "provider",
      ref: `${id}@${version}`,
    });
    const raw = yield* invokeProvider({ id, ref, input, ctx, chain, impl });
    return yield* decodeProviderOutput({ contract, raw, id, ref, chain });
  });
}

function invokeProvider(options: {
  readonly id: string;
  readonly ref: string;
  readonly input: unknown;
  readonly ctx: CapabilityCtx;
  readonly chain: CallChain;
  readonly impl: ProviderImpl;
}): Effect.Effect<unknown, ProviderFailure> {
  return Effect.tryPromise({
    try: () =>
      options.impl.invoke(options.input, {
        ...options.ctx,
        chain: options.chain,
      }),
    catch: (cause): ProviderFailure =>
      isTaggedError(cause) && cause.retryable
        ? { kind: "soft", cause }
        : {
          kind: "hard",
          error: new CapabilityError({
            reason: "failed",
            detail: `provider '${options.id}' failed for '${options.ref}'`,
            chain: options.chain,
            cause,
          }),
        },
  });
}

function decodeProviderOutput(options: {
  readonly contract: CapabilityContract;
  readonly raw: unknown;
  readonly id: string;
  readonly ref: string;
  readonly chain: CallChain;
}): Effect.Effect<unknown, ProviderFailure> {
  const decoded = Schema.decodeUnknownResult(options.contract.output)(
    options.raw,
  );
  if (Result.isSuccess(decoded)) return Effect.succeed(decoded.success);
  return Effect.fail({
    kind: "hard",
    error: new CapabilityError({
      reason: "bad_output",
      detail: `provider '${options.id}' broke '${options.ref}': ${
        formatIssues(decoded.failure)
      }`,
      chain: options.chain,
    }),
  });
}

function formatIssues(error: Schema.SchemaError): string {
  return SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
}

function formatIssuePath(path: ReadonlyArray<unknown> | undefined): string {
  return path?.length ? path.map(formatPathSegment).join(".") : "(root)";
}

function formatPathSegment(segment: unknown): string {
  let value = segment;
  if (typeof value === "object" && value !== null && "key" in value) {
    value = value.key;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "symbol") {
    return value.description ?? value.toString();
  }
  return "<unknown>";
}
