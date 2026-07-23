import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type { Inbound } from "../../core/channels/types.js";
import {
  ApprovalSvc,
  ErrorReporterSvc,
  ObsSvc,
} from "../../core/di/services.js";
import { isTaggedError } from "../../core/errors.js";
import type { Origin } from "../../core/types.js";
import { RuntimeEnvSvc } from "./env.js";
import type {
  ApprovalCommand,
  ApprovalExecution,
  Deliver,
  InboundContext,
} from "./inbound/types.js";
import { runTurn } from "./turn.js";
import type { RuntimeEnv, RuntimeServices } from "./types.js";

const MIN_NONCE_CHARS = 8;

export function handleInbound(
  message: Inbound,
): Effect.Effect<void, never, RuntimeServices> {
  return Effect.gen(function*() {
    const env = yield* RuntimeEnvSvc;
    const obs = yield* ObsSvc;
    const approval = yield* Effect.serviceOption(ApprovalSvc);
    const deliver = createDeliver(env, message);
    yield* processInbound({ message, env, obs, approval, deliver });
  });
}

function processInbound(
  context: InboundContext,
): Effect.Effect<void, never, RuntimeServices> {
  return Effect.gen(function*() {
    const { deliver, env, message } = context;
    if (yield* wasSeen(env, message)) return;
    if (yield* handleApproval(context)) return;
    if (env.inflight.has(message.conversationKey)) {
      yield* deliver("One sec — still working on your last message.");
      return;
    }
    const origin = yield* screenOrigin(context);
    if (!origin) return;
    env.inflight.add(message.conversationKey);
    yield* executeTurn(context, origin).pipe(
      Effect.ensuring(
        Effect.sync(() => env.inflight.delete(message.conversationKey)),
      ),
    );
  });
}

function createDeliver(env: RuntimeEnv, message: Inbound): Deliver {
  return (text) =>
    Effect.ignore(
      Effect.tryPromise({
        try: () => env.deliver(message.conversationKey, text),
        catch: (error) => error,
      }),
    );
}

function wasSeen(
  env: RuntimeEnv,
  message: Inbound,
): Effect.Effect<boolean> {
  if (!env.seenBefore) return Effect.succeed(false);
  const seenBefore = env.seenBefore;
  return Effect.promise(() => seenBefore(message.channel, message.externalId));
}

function handleApproval(
  context: InboundContext,
): Effect.Effect<boolean> {
  const { approval, deliver, message } = context;
  const command = parseApprovalCommand(message.text);
  if (!command || message.origin !== "owner" || Option.isNone(approval)) {
    return Effect.succeed(false);
  }
  return completeApproval({
    gate: approval.value,
    command,
    message,
    deliver,
  });
}

function completeApproval(
  execution: ApprovalExecution,
): Effect.Effect<boolean> {
  return Effect.gen(function*() {
    const { command, deliver, gate, message } = execution;
    if (command.verb === "deny") {
      const { nonce } = command;
      gate.deny(nonce);
      yield* deliver("Denied — action discarded.");
      return true;
    }
    const hash = gate.pendingHash(command.nonce);
    if (!hash) {
      yield* deliver("That approval expired or was already used.");
      return true;
    }
    const result = yield* Effect.promise(() =>
      gate.approve({
        nonce: command.nonce,
        sender: message.senderId,
        payloadHash: hash,
        ...(command.variantIndex && { variantIndex: command.variantIndex }),
      })
    );
    yield* deliver(
      result.ok
        ? `Approved.\n\n${result.result ?? ""}`
        : `Couldn't approve: ${result.reason}`,
    );
    return true;
  });
}

function parseApprovalCommand(text: string): ApprovalCommand | undefined {
  const [rawVerb, nonce, rawVariant, ...extra] = text.trim().split(/\s+/);
  const verb = parseApprovalVerb(rawVerb);
  if (!verb || !nonce || !isValidNonce(nonce)) return undefined;
  if (rawVariant !== undefined && !isValidVariant(rawVariant)) return undefined;
  if (extra.length > 0) return undefined;
  return {
    verb,
    nonce,
    ...(rawVariant && { variantIndex: Number(rawVariant) }),
  };
}

function parseApprovalVerb(
  value: string | undefined,
): ApprovalCommand["verb"] | undefined {
  const normalized = value?.toLowerCase();
  return normalized === "approve" || normalized === "deny"
    ? normalized
    : undefined;
}

function isValidNonce(value: string): boolean {
  return value.length >= MIN_NONCE_CHARS && /^[a-f\d]+$/i.test(value);
}

function isValidVariant(value: string): boolean {
  return /^\d+$/.test(value);
}

function screenOrigin(
  context: InboundContext,
): Effect.Effect<Origin | undefined> {
  const { deliver, env, message, obs } = context;
  if (!env.injectionScreen) return Effect.succeed(message.origin);
  const injectionScreen = env.injectionScreen;
  return Effect.gen(function*() {
    const screen = yield* Effect.promise(() =>
      injectionScreen.screen(message.text, message.origin)
    );
    if (screen.decision !== "block") return screen.origin;
    obs.counter("agentkit.injection.blocked", 1, { risk: screen.risk });
    yield* deliver(
      "I can't act on that message — it looks like a prompt-injection attempt.",
    );
    return undefined;
  });
}

function executeTurn(
  context: InboundContext,
  origin: Origin,
): Effect.Effect<void, never, RuntimeServices> {
  const { deliver, env, message, obs } = context;
  return Effect.gen(function*() {
    const outcome = yield* Effect.result(
      runTurn({
        conversationKey: message.conversationKey,
        agentId: env.agents.defaultAgentId,
        text: message.text,
        origin,
      }),
    );
    if (Result.isSuccess(outcome)) {
      yield* deliver(formatTurnReply(outcome.success));
      return;
    }
    const error = outcome.failure;
    const detail = isTaggedError(error) ? error._tag : "error";
    obs.recordError(detail, describe(error), {
      "agentkit.conversation": message.conversationKey,
    });
    // Belt to turn.ts's tapError seam (the reporter dedupes by error object)
    // PLUS a plain stderr line — a chat-visible failure must be findable in
    // `docker logs` even when OTel/GlitchTip export is having a bad day.
    console.error(
      `[inbound] turn failed (${detail}) on ${message.conversationKey}: ${
        describe(error)
      }`,
    );
    const reporter = yield* Effect.serviceOption(ErrorReporterSvc);
    Option.getOrUndefined(reporter)?.captureException(error, {
      mechanism: "inbound",
      handled: true,
      tags: { channel: message.channel, conversation: message.conversationKey },
    });
    yield* deliver(
      `Something went wrong handling that (${detail}). I've logged it.`,
    );
  });
}

function formatTurnReply(result: {
  readonly text: string;
  readonly roundsExhausted: boolean;
}): string {
  const text = result.roundsExhausted
    ? `${result.text}\n\n_(I hit my step limit — this may be partial.)_`
    : result.text;
  return text || "…";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
