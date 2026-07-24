import { describe, expect, it } from "bun:test";
import { hashValue } from "../../../src/core/digest";
import { SessionStore } from "../../../src/memory/session-store/index";
import { RuntimeEvolutionEvidence } from "../../../src/runtime/evolution-evidence";

describe("runtime evolution evidence", () => {
  it("records digest-only tool outcomes and attributable feedback", async () => {
    const store = new SessionStore();
    let time = 0;
    let sequence = 0;
    const forwarded: string[] = [];
    const evidence = new RuntimeEvolutionEvidence({
      sink: store.evolution,
      targetsForTool: (toolName) =>
        toolName === "brave_search"
          ? [{
            targetRef: "core/tool/search-brave",
            digest: "sha256:active-description",
          }]
          : [],
      turnTargets: () => [],
      toolNames: ["brave_search"],
      report: () => {
        throw new Error("evidence recording unexpectedly failed");
      },
      now: () => new Date(time),
      newId: (prefix) => `${prefix}-${++sequence}`,
    });
    const turn = evidence.beginTurn({
      conversation: "gateway-slack:C123:root",
      channelKey: "gateway-slack:C123",
      snapshotId: "snapshot:active",
      observer: {
        onToolProgress: async (progress) => {
          forwarded.push(progress.status);
        },
      },
    });
    await turn.observer.onModelSelection?.({
      routeDigest: "sha256:route",
      usageReference: "sha256:usage",
    });
    await turn.observer.onToolProgress?.({
      id: "call-1",
      name: "brave_search",
      status: "in_progress",
      schemaDigest: "sha256:schema",
      argumentsDigest: "sha256:arguments",
    });
    time = 25;
    await turn.observer.onToolProgress?.({
      id: "call-1",
      name: "brave_search",
      status: "complete",
      schemaDigest: "sha256:schema",
      argumentsDigest: "sha256:arguments",
      resultDigest: "sha256:result",
    });
    turn.finish("success");
    evidence.recordFeedback({
      gateway: "gateway-slack",
      channel: "C123",
      message: "raw user feedback must not be retained",
      sender: "U123",
      sentiment: "positive",
      source: "reaction",
    });

    const runs = store.evolution.runsForSession(
      hashValue("gateway-slack:C123:root"),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      snapshotId: "snapshot:active",
      disposition: "success",
    });
    expect(store.evolution.toolCallsForRun(turn.runId)).toEqual([{
      id: "tool-call-3",
      runId: turn.runId,
      requestedTool: "brave_search",
      selectedTool: "brave_search",
      schemaDigest: "sha256:schema",
      argumentsDigest: "sha256:arguments",
      resultDigest: "sha256:result",
      latencyMilliseconds: 25,
      errorTag: null,
      createdAt: new Date(time).toISOString(),
    }]);
    expect(
      store.evolution.toolFailureSummaryForTarget(
        "core/tool/search-brave",
        "sha256:active-description",
      ),
    ).toEqual({ failures: [], totalCalls: 1 });
    expect(store.evolution.componentUsesForRun(turn.runId)).toEqual([{
      id: "component-use-4",
      runId: turn.runId,
      componentRef: "core/tool/search-brave",
      componentDigest: "sha256:active-description",
      operation: "brave_search",
      outcome: "success",
      createdAt: new Date(time).toISOString(),
    }]);
    expect(store.evolution.modelSelectionsForRun(turn.runId)).toEqual([{
      id: "model-selection-2",
      runId: turn.runId,
      routeDigest: "sha256:route",
      usageReference: "sha256:usage",
      createdAt: new Date(0).toISOString(),
    }]);
    const feedback = store.evolution.feedbackForTarget(
      "core/tool/search-brave",
    );
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.evidenceDigest).toBe(hashValue({
      gateway: "gateway-slack",
      channel: "C123",
      sender: "U123",
      source: "reaction",
      sentiment: "positive",
    }));
    expect(JSON.stringify(feedback)).not.toContain("raw user feedback");
    expect(forwarded).toEqual(["in_progress", "complete"]);
    store.close();
  });

  it("mines digest-bound tool failures for continuous triage", () => {
    const store = new SessionStore();
    store.evolution.recordRun({
      id: "run-failure",
      sessionId: "session",
      snapshotId: "snapshot",
      agentRef: "core/agent/elliott",
      disposition: "failure",
      startedAt: new Date(0).toISOString(),
    });
    store.evolution.recordToolCall({
      id: "tool-failure",
      runId: "run-failure",
      requestedTool: "brave_search",
      selectedTool: "brave_search",
      schemaDigest: "sha256:schema",
      resultDigest: "sha256:result",
      latencyMilliseconds: 10,
      errorTag: "network-error",
      createdAt: new Date(0).toISOString(),
    });
    store.evolution.recordComponentUse({
      id: "component-failure",
      runId: "run-failure",
      componentRef: "core/tool/search-brave",
      componentDigest: "sha256:active-description",
      operation: "brave_search",
      outcome: "failure",
      createdAt: new Date(0).toISOString(),
    });
    const summary = store.evolution.toolFailureSummaryForTarget(
      "core/tool/search-brave",
      "sha256:active-description",
    );
    expect(summary.totalCalls).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toMatchObject({
      id: "tool-failure",
      errorTag: "network-error",
      resultDigest: "sha256:result",
    });
    expect(
      store.evolution.toolFailureSummaryForTarget(
        "core/tool/search-brave",
        "sha256:stale-description",
      ),
    ).toEqual({ failures: [], totalCalls: 0 });
    store.close();
  });

  it("keeps evidence persistence failures observational", async () => {
    const failures: unknown[] = [];
    const observerCalls: string[] = [];
    const fail = (): never => {
      throw new Error("database unavailable");
    };
    const evidence = new RuntimeEvolutionEvidence({
      sink: {
        recordRun: fail,
        finishRun: fail,
        recordToolCall: fail,
        recordComponentUse: fail,
        recordFeedback: fail,
      },
      targetsForTool: () => [],
      turnTargets: () => [],
      toolNames: [],
      report: (error) => failures.push(error),
      newId: (prefix) => prefix,
    });
    const turn = evidence.beginTurn({
      conversation: "conversation",
      channelKey: "gateway:channel",
      snapshotId: "snapshot:active",
      observer: {
        onToolProgress: async (progress) => {
          observerCalls.push(progress.status);
        },
      },
    });
    await turn.observer.onToolProgress?.({
      id: "call-1",
      name: "tool",
      status: "complete",
    });
    turn.finish("success");
    expect(observerCalls).toEqual(["complete"]);
    expect(failures).toHaveLength(1);
  });

  it("attributes existing conversations to the target revision they pinned", async () => {
    const store = new SessionStore();
    let activeDigest = "sha256:one";
    let sequence = 0;
    const evidence = new RuntimeEvolutionEvidence({
      sink: store.evolution,
      targetsForTool: () => [{
        targetRef: "core/tool/search-brave",
        digest: activeDigest,
      }],
      turnTargets: () => [],
      toolNames: ["brave_search"],
      report: (error) => {
        throw error;
      },
      newId: (prefix) => `${prefix}-${++sequence}`,
    });
    evidence.beginTurn({
      conversation: "existing",
      channelKey: "gateway:existing",
      snapshotId: "snapshot:one",
    }).finish("success");
    activeDigest = "sha256:two";
    const existing = evidence.beginTurn({
      conversation: "existing",
      channelKey: "gateway:existing",
      snapshotId: "snapshot:one",
    });
    await existing.observer.onToolProgress?.({
      id: "existing-call",
      name: "brave_search",
      status: "complete",
    });
    existing.finish("success");
    const current = evidence.beginTurn({
      conversation: "current",
      channelKey: "gateway:current",
      snapshotId: "snapshot:two",
    });
    await current.observer.onToolProgress?.({
      id: "current-call",
      name: "brave_search",
      status: "complete",
    });
    current.finish("success");
    expect(
      store.evolution.componentUsesForRun(existing.runId)[0]?.componentDigest,
    ).toBe("sha256:one");
    expect(
      store.evolution.componentUsesForRun(current.runId)[0]?.componentDigest,
    ).toBe("sha256:two");
    store.close();
  });

  it("records prompt and skill sources for feedback attribution", () => {
    const store = new SessionStore();
    let sequence = 0;
    const evidence = new RuntimeEvolutionEvidence({
      sink: store.evolution,
      targetsForTool: () => [],
      turnTargets: () => [
        {
          targetRef: "core/prompt/elliott-interaction-profile",
          digest: "sha256:prompt",
        },
        {
          targetRef: "core/skill/code-review",
          digest: "sha256:skill",
        },
      ],
      toolNames: [],
      report: (error) => {
        throw error;
      },
      newId: (prefix) => `${prefix}-${++sequence}`,
    });
    const turn = evidence.beginTurn({
      conversation: "gateway:C123:root",
      channelKey: "gateway:C123",
      snapshotId: "snapshot:one",
    });
    turn.finish("failure");
    evidence.recordFeedback({
      gateway: "gateway",
      channel: "C123",
      message: "opaque-message-id",
      sender: "owner",
      sentiment: "negative",
      source: "button",
    });
    expect(
      store.evolution.componentUsesForRun(turn.runId).map((item) => [
        item.componentRef,
        item.componentDigest,
        item.outcome,
      ]),
    ).toEqual([
      [
        "core/prompt/elliott-interaction-profile",
        "sha256:prompt",
        "failure",
      ],
      ["core/skill/code-review", "sha256:skill", "failure"],
    ]);
    expect([
      ...store.evolution.feedbackForTarget(
        "core/prompt/elliott-interaction-profile",
      ),
      ...store.evolution.feedbackForTarget("core/skill/code-review"),
    ]).toHaveLength(2);
    store.close();
  });
});
