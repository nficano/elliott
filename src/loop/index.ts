import { scopeId } from "../core/brands";
import { newId } from "../core/digest";
import { NoEligibleRouteError } from "../core/errors";
import type { DataClassification } from "../core/types";
import { assemblePrompt, maximumClassification } from "../prompt/index";
import type {
  AgentLoopDependencies,
  AgentTurnRequest,
  CausalBlock,
  CausalEvent,
  CompactionResult,
  LoopInferenceResult,
  TurnDisposition,
} from "./types";

/** Maps a resolved inference to its turn disposition: empty text falls
 *  silent, otherwise a frozen `respond` envelope stamped with the injected
 *  id/createdAt. Pure: no id/time generation of its own. */
export const dispositionFromInference = (
  inference: LoopInferenceResult,
  classification: DataClassification,
  ctx: { readonly id: string; readonly createdAt: string; },
): TurnDisposition => {
  if (inference.text.length === 0) {
    return { type: "silent", reason: "no-user-visible-result" };
  }
  return {
    type: "respond",
    message: Object.freeze({
      id: ctx.id,
      actorTrust: "authenticated",
      contentTrust: "trusted",
      classification,
      securityTags: Object.freeze([]),
      payload: inference.text,
      createdAt: ctx.createdAt,
    }),
  };
};

export class AgentTurnLoop {
  readonly #dependencies: AgentLoopDependencies;

  constructor(dependencies: AgentLoopDependencies) {
    this.#dependencies = dependencies;
  }

  async run(request: AgentTurnRequest): Promise<TurnDisposition> {
    if (!this.#dependencies.hasSnapshot(request.snapshot)) {
      throw new Error(`Unknown snapshot ${request.snapshot}`);
    }
    const prompt = assemblePrompt(request.snapshot, request.segments);
    await this.#dependencies.records.append({
      type: "turn.started",
      scope: { level: "session", id: scopeId(request.inbound.id) },
      durability: "observational",
      classification: prompt.effectiveClassification,
      payload: { snapshot: request.snapshot, inbound: request.inbound.id },
    });
    try {
      const inference = await this.#dependencies.dispatcher.infer(prompt);
      for (const call of inference.toolCalls) {
        await this.#dependencies.broker.execute(call, request.snapshot);
      }
      return dispositionFromInference(
        inference,
        prompt.effectiveClassification,
        {
          id: newId("envelope"),
          createdAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      if (error instanceof NoEligibleRouteError) {
        return { type: "blocked-no-route", error: error };
      }
      throw error;
    }
  }
}

export const compactCausalBlocks = async (
  blocks: readonly CausalBlock[],
  retainCount: number,
  summarize: (blocks: readonly CausalBlock[]) => Promise<string>,
): Promise<CompactionResult> => {
  if (blocks.length <= retainCount) {
    return { retained: blocks, compactedBlockIds: [] };
  }
  const boundary = blocks.length - retainCount;
  const compacted = blocks.slice(0, boundary);
  const retained = blocks.slice(boundary);
  const content = await summarize(compacted);
  const summaryEvent: CausalEvent = Object.freeze({
    id: newId("summary"),
    kind: "message",
    content,
  });
  const summary: CausalBlock = Object.freeze({
    id: newId("compaction"),
    classification: maximumClassification(
      compacted.map((block) => block.classification),
    ),
    events: Object.freeze([summaryEvent]),
  });
  return {
    retained: Object.freeze([summary, ...retained]),
    compactedBlockIds: compacted.map((block) => block.id),
    summary,
  };
};

export type * from "./types";
