/* eslint-disable max-lines */
import * as Effect from "effect/Effect";
import { hashValue } from "../core/digest";
import {
  recordEvolutionToolConfusionMetric,
} from "../learning/evolution/observability/index";
import type { GatewayFeedback } from "./skills/types";
import type {
  RuntimeEvolutionEvidenceInput,
  RuntimeEvolutionTargetIdentity,
  RuntimeEvolutionTurnEvidence,
  TurnObserver,
  TurnToolProgress,
} from "./types";

const defaultId = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID()}`;

const componentOutcome = (
  disposition: Parameters<RuntimeEvolutionTurnEvidence["finish"]>[0],
): "success" | "failure" | "unknown" => {
  if (disposition === "success") return "success";
  return disposition === "failure" ? "failure" : "unknown";
};

export class RuntimeEvolutionEvidence {
  readonly #input: RuntimeEvolutionEvidenceInput;
  readonly #toolTargetsByConversation = new Map<
    string,
    ReadonlyMap<string, readonly RuntimeEvolutionTargetIdentity[]>
  >();
  readonly #turnTargetsByConversation = new Map<
    string,
    readonly RuntimeEvolutionTargetIdentity[]
  >();
  readonly #latestTargetsByChannel = new Map<
    string,
    {
      readonly runId: string;
      readonly targets: readonly RuntimeEvolutionTargetIdentity[];
    }
  >();

  constructor(input: RuntimeEvolutionEvidenceInput) {
    this.#input = input;
  }

  beginTurn(input: {
    readonly conversation: string;
    readonly channelKey: string;
    readonly snapshotId: string;
    readonly retainConversation?: boolean;
    readonly observer?: TurnObserver;
  }): RuntimeEvolutionTurnEvidence {
    const runId = this.#id("session-run");
    const targets = this.#targetsForConversation(
      input.conversation,
      input.retainConversation !== false,
    );
    const recorded = this.#recordRun(
      runId,
      input.conversation,
      input.snapshotId,
    );
    if (recorded) {
      this.#rememberTargets(input.channelKey, runId, targets.turnTargets);
    }
    return {
      runId,
      observer: recorded
        ? this.#observer({
          observer: input.observer,
          runId,
          channelKey: input.channelKey,
          toolTargets: targets.toolTargets,
        })
        : input.observer ?? {},
      finish: (disposition) => {
        if (!recorded) return;
        this.#recordTurnComponentUses(
          runId,
          targets.turnTargets,
          componentOutcome(disposition),
        );
        this.#capture(() =>
          this.#input.sink.finishRun(
            runId,
            disposition,
            this.#timestamp(),
          )
        );
      },
    };
  }

  #recordRun(runId: string, conversation: string, snapshotId: string): boolean {
    return this.#capture(() =>
      this.#input.sink.recordRun({
        id: runId,
        sessionId: hashValue(conversation),
        snapshotId,
        agentRef: "core/agent/elliott",
        disposition: "unknown",
        startedAt: this.#timestamp(),
      })
    );
  }

  recordFeedback(feedback: GatewayFeedback): void {
    const latest = this.#latestTargetsByChannel.get(
      `${feedback.gateway}:${feedback.channel}`,
    );
    if (latest === undefined) return;
    const evidenceDigest = hashValue({
      gateway: feedback.gateway,
      channel: feedback.channel,
      sender: feedback.sender,
      source: feedback.source,
      sentiment: feedback.sentiment,
    });
    for (const target of latest.targets) {
      this.#capture(() =>
        this.#input.sink.recordFeedback({
          id: this.#id("feedback"),
          runId: latest.runId,
          targetRef: target.targetRef,
          kind: feedback.sentiment === "positive"
            ? "confirmed-success"
            : "confirmed-failure",
          evidenceDigest,
          createdAt: this.#timestamp(),
        })
      );
    }
  }

  #observer(input: {
    readonly observer: TurnObserver | undefined;
    readonly runId: string;
    readonly channelKey: string;
    readonly toolTargets: ReadonlyMap<
      string,
      readonly RuntimeEvolutionTargetIdentity[]
    >;
  }): TurnObserver {
    const { channelKey, observer, runId, toolTargets } = input;
    const started = new Map<string, number>();
    return {
      ...(observer?.onTextDelta !== undefined && {
        onTextDelta: observer.onTextDelta,
      }),
      onModelSelection: async (selection) => {
        await observer?.onModelSelection?.(selection);
        this.#capture(() =>
          this.#input.sink.recordModelSelection({
            id: this.#id("model-selection"),
            runId,
            routeDigest: selection.routeDigest,
            usageReference: selection.usageReference,
            createdAt: this.#timestamp(),
          })
        );
      },
      onToolProgress: async (progress) => {
        await observer?.onToolProgress?.(progress);
        if (progress.status === "in_progress") {
          started.set(progress.id, this.#now().getTime());
          return;
        }
        const targets = toolTargets.get(progress.name) ?? [];
        this.#recordToolProgress({
          progress,
          runId,
          channelKey,
          startedAt: started.get(progress.id) ?? this.#now().getTime(),
          targets,
        });
      },
    };
  }

  // eslint-disable-next-line max-lines-per-function
  #recordToolProgress(input: {
    readonly progress: TurnToolProgress;
    readonly runId: string;
    readonly channelKey: string;
    readonly startedAt: number;
    readonly targets: readonly RuntimeEvolutionTargetIdentity[];
  }): void {
    const { channelKey, progress, runId, startedAt, targets } = input;
    const outcome = progress.status === "error" ? "failure" : "success";
    const createdAt = this.#timestamp();
    const requestedTool = progress.requestedTool ?? progress.name;
    const selectedTool = progress.requestedTool === undefined
      ? progress.name
      : progress.selectedTool;
    if (selectedTool !== undefined) {
      this.#capture(() =>
        Effect.runSync(
          recordEvolutionToolConfusionMetric(requestedTool, selectedTool),
        )
      );
    }
    this.#capture(() =>
      this.#input.sink.recordToolCall({
        id: this.#id("tool-call"),
        runId,
        requestedTool,
        ...(selectedTool !== undefined && { selectedTool }),
        schemaDigest: progress.schemaDigest
          ?? hashValue({ unknownToolSchema: progress.name }),
        ...(progress.argumentsDigest !== undefined && {
          argumentsDigest: progress.argumentsDigest,
        }),
        ...(progress.resultDigest !== undefined && {
          resultDigest: progress.resultDigest,
        }),
        latencyMilliseconds: Math.max(
          0,
          this.#now().getTime() - startedAt,
        ),
        ...(progress.errorTag !== undefined && {
          errorTag: progress.errorTag,
        }),
        createdAt,
      })
    );
    for (const target of targets) {
      this.#capture(() =>
        this.#input.sink.recordComponentUse({
          id: this.#id("component-use"),
          runId,
          componentRef: target.targetRef,
          componentDigest: target.digest,
          operation: progress.name,
          outcome,
          createdAt,
        })
      );
    }
    this.#rememberTargets(channelKey, runId, targets);
  }

  #capture(action: () => void): boolean {
    try {
      action();
      return true;
    } catch (error) {
      this.#input.report(error);
      return false;
    }
  }

  #targetsForConversation(
    conversation: string,
    retain: boolean,
  ) {
    if (retain) {
      const toolTargets = this.#toolTargetsByConversation.get(conversation);
      const turnTargets = this.#turnTargetsByConversation.get(conversation);
      if (toolTargets !== undefined && turnTargets !== undefined) {
        return { toolTargets, turnTargets };
      }
    } else {
      this.#toolTargetsByConversation.delete(conversation);
      this.#turnTargetsByConversation.delete(conversation);
    }
    const toolTargets = new Map(
      this.#input.toolNames.map((toolName) => [
        toolName,
        this.#input.targetsForTool(toolName),
      ]),
    );
    const turnTargets = this.#input.turnTargets();
    if (retain) {
      this.#toolTargetsByConversation.set(conversation, toolTargets);
      this.#turnTargetsByConversation.set(conversation, turnTargets);
    }
    return { toolTargets, turnTargets };
  }

  #recordTurnComponentUses(
    runId: string,
    targets: readonly RuntimeEvolutionTargetIdentity[],
    outcome: "success" | "failure" | "unknown",
  ): void {
    const createdAt = this.#timestamp();
    for (const target of targets) {
      this.#capture(() =>
        this.#input.sink.recordComponentUse({
          id: this.#id("component-use"),
          runId,
          componentRef: target.targetRef,
          componentDigest: target.digest,
          operation: "system-prompt-source",
          outcome,
          createdAt,
        })
      );
    }
  }

  #rememberTargets(
    channelKey: string,
    runId: string,
    targets: readonly RuntimeEvolutionTargetIdentity[],
  ): void {
    const existing = this.#latestTargetsByChannel.get(channelKey);
    const combined = new Map(
      (existing?.runId === runId ? existing.targets : [])
        .map((target) => [target.targetRef, target]),
    );
    for (const target of targets) combined.set(target.targetRef, target);
    this.#latestTargetsByChannel.set(channelKey, {
      runId,
      targets: [...combined.values()],
    });
  }

  #now(): Date {
    return this.#input.now?.() ?? new Date();
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #id(prefix: string): string {
    return this.#input.newId?.(prefix) ?? defaultId(prefix);
  }
}
