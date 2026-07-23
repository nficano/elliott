import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createHash, randomBytes } from "node:crypto";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import type { ApprovalPrompt, ApprovalVariant, StagedAction } from "./types.js";

const DEFAULT_APPROVAL_TTL_MINUTES = 10;
const MILLISECONDS_PER_MINUTE = 60_000;
const DEFAULT_APPROVAL_TTL_MS = DEFAULT_APPROVAL_TTL_MINUTES
  * MILLISECONDS_PER_MINUTE;
const NONCE_BYTES = 16;
const ARG_SUMMARY_MAX_CHARS = 300;

/**
 * Approval gate (§16). Writes are a separate registry behind an approval gate —
 * the model loop never holds real write executes. A write stages behind an owner
 * Approve/Deny action (10-min timeout). The callback verifies (a) sender ==
 * owner, (b) a single-use nonce bound to a HASH OF THE STAGED ACTION PAYLOAD,
 * (c) not expired. Without the payload-hash binding a stale/replayed callback
 * would approve whatever happens to be staged now (the confused-deputy bug).
 *
 * Approval-choice VARIANTS (CAPABILITIES-TDD §9.5): a staged action may carry
 * alternative dispositions (e.g. "cancel" vs "cancel + refund"); the approver's
 * choice — not the model's — fixes the arguments the write runs with. The
 * variant set is part of the hashed payload, so a replay can't swap choices.
 */
export class ApprovalGate {
  private readonly staged = new Map<string, StagedAction>();

  constructor(
    private readonly ownerId: string,
    private readonly ttlMs = DEFAULT_APPROVAL_TTL_MS,
  ) {}

  /** Stage an action; returns the owner-facing prompt + the binding it must echo. */
  stage(params: {
    readonly tool: string;
    readonly args: unknown;
    readonly summary: string;
    readonly run: (chosenArgs?: unknown) => Promise<string>;
    readonly variants?: readonly ApprovalVariant[];
  }): ApprovalPrompt {
    const nonce = randomBytes(NONCE_BYTES).toString("hex");
    const payloadHash = hashPayload(params.tool, params.args, params.variants);
    this.staged.set(nonce, {
      nonce,
      payloadHash,
      tool: params.tool,
      summary: params.summary,
      expiresAt: Date.now() + this.ttlMs,
      ...(params.variants?.length && { variants: params.variants }),
      run: params.run,
    });
    const choices = params.variants?.length
      ? `\n${
        params.variants.map((v, i) => `  ${i + 1}. ${v.label}`).join("\n")
      }\n\nReply APPROVE ${nonce} <choice #> or DENY ${nonce}.`
      : `\n\nReply APPROVE ${nonce} or DENY ${nonce}.`;
    return {
      nonce,
      payloadHash,
      text: `Approve action **${params.tool}**?\n${params.summary}${choices}`,
    };
  }

  /**
   * Approve by nonce. Verifies owner, single-use nonce, payload-hash binding, and
   * expiry, then runs the real execute (the only caller of it). When the staged
   * action carries variants, `variantIndex` (1-based) selects the disposition and
   * is REQUIRED — an approval without a choice must not guess one.
   */
  async approve(params: {
    readonly nonce: string;
    readonly sender: string;
    readonly payloadHash: string;
    readonly variantIndex?: number;
  }): Promise<{ ok: boolean; result?: string; reason?: string; }> {
    const action = this.staged.get(params.nonce);
    if (!action) return { ok: false, reason: "unknown or already-used nonce" };
    // Validate BEFORE consuming — a failed attempt (wrong sender/hash) must not
    // burn a pending approval. All checks below are synchronous (no await), so
    // the consume+run is atomic w.r.t. a concurrent duplicate approve.
    if (params.sender !== this.ownerId) {
      return { ok: false, reason: "sender is not the owner" };
    }
    if (Date.now() > action.expiresAt) {
      this.staged.delete(params.nonce);
      return { ok: false, reason: "approval expired" };
    }
    if (params.payloadHash !== action.payloadHash) {
      return { ok: false, reason: "payload-hash mismatch (stale/replayed)" };
    }
    let chosen: unknown;
    if (action.variants?.length) {
      if (
        params.variantIndex === undefined || params.variantIndex < 1
        || params.variantIndex > action.variants.length
      ) {
        return {
          ok: false,
          reason: `choose a disposition 1-${action.variants.length}`,
        };
      }
      chosen = action.variants[params.variantIndex - 1]!.args;
    }
    // All checks pass → consume now so a replay of a SUCCESS can't double-fire.
    this.staged.delete(params.nonce);
    const result = await action.run(chosen);
    return { ok: true, result };
  }

  deny(nonce: string): boolean {
    return this.staged.delete(nonce);
  }

  /** The stored payload hash for a nonce (for the text-approve flow; the hardened
   *  path is an inline button whose callback_data carries the hash). */
  pendingHash(nonce: string): string | undefined {
    return this.staged.get(nonce)?.payloadHash;
  }

  has(nonce: string): boolean {
    return this.staged.has(nonce);
  }

  /** Reap expired staged actions (call on a timer). */
  reap(): void {
    const now = Date.now();
    for (const [nonce, a] of this.staged) {
      if (now > a.expiresAt) this.staged.delete(nonce);
    }
  }
}

function hashPayload(
  tool: string,
  args: unknown,
  variants?: readonly ApprovalVariant[],
): string {
  return createHash("sha256")
    .update(
      `${tool}:${JSON.stringify(args ?? {})}:${JSON.stringify(variants ?? [])}`,
    )
    .digest("hex");
}

/**
 * Wrap a write tool so the loop can only STAGE it, never execute it (§16). The
 * model gets an immediate "staged for approval" result; the real run happens when
 * the owner approves via `gate.approve`. `deliverApproval` sends the prompt out
 * of band (e.g. a Telegram Approve/Deny message). `variantsFor` lets a consumer
 * declare per-tool dispositions the APPROVER picks (TDD §9.5) — when present,
 * the approved variant's args replace the model's staged args.
 */
export function withApprovalGate(params: {
  readonly tool: ToolDef;
  readonly gate: ApprovalGate;
  readonly deliverApproval: (prompt: string) => Promise<void>;
  readonly variantsFor?: (
    toolName: string,
    args: unknown,
  ) => readonly ApprovalVariant[] | undefined;
}): ToolDef {
  const { tool } = params;
  return define({
    name: tool.name,
    description: tool.description,
    // Re-derive the same schema so args are still validated before staging.
    schema: passthroughSchema(),
    meta: {
      componentId: tool.meta.componentId,
      bundle: tool.meta.bundle,
      core: tool.meta.core,
      write: true,
    },
    run: async (args, ctx) => {
      const variants = params.variantsFor?.(tool.name, args);
      const prompt = params.gate.stage({
        tool: tool.name,
        args,
        summary: `args: ${
          JSON.stringify(args).slice(0, ARG_SUMMARY_MAX_CHARS)
        }`,
        run: (chosenArgs) =>
          Effect.runPromise(
            Effect.match(tool.execute(chosenArgs ?? args, ctx), {
              onSuccess: (ok) => ok,
              onFailure: (err) => JSON.stringify({ error: err.message }),
            }),
          ),
        ...(variants && { variants }),
      });
      await params.deliverApproval(prompt.text);
      return JSON.stringify({
        staged: true,
        note: variants?.length
          ? "This action needs owner approval; the owner will also choose the disposition. Do not retry."
          : "This action needs owner approval and has been sent for confirmation. Do not retry.",
      });
    },
  });
}

// The wrapped tool re-validates against a permissive object schema; the inner
// tool re-validates with its real Effect Schema when the gate finally runs it.
function passthroughSchema(): Schema.Decoder<Record<string, unknown>> {
  return Schema.Record(Schema.String, Schema.Unknown);
}
