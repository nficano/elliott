import type { TraceStep, TurnDetail } from "#shared/types/trace";

import { MAP_BASE } from "#shared/utils/base";
import { buildTraceSteps, traceFlow } from "#shared/utils/trace";

import { startFlow, useExplorer } from "./useExplorer";

// Replays a recorded invocation like a debugger: no re-execution — the
// recorded events are mapped onto topology hops, the comet walks them, and
// the drawer shows what each node received and returned.

const MAX_TITLE = 60;

const replayTitle = (runId: string): string => {
  const explorer = useExplorer();
  const item = explorer.invocations.value.find(
    (candidate) => candidate.runId === runId,
  );
  const text = item?.text || item?.sender || runId;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
};

export const currentTraceStep = (): TraceStep | null => {
  const explorer = useExplorer();
  const trace = explorer.trace.value;
  if (!trace) return null;
  return trace.steps[explorer.flowUi.value.stepIndex] ?? null;
};

export const startTraceReplay = async (runId: string): Promise<void> => {
  const explorer = useExplorer();
  try {
    const response = await fetch(
      `${MAP_BASE}/turn?id=${encodeURIComponent(runId)}`,
    );
    if (!response.ok) return;
    const detail = (await response.json()) as TurnDetail;
    const steps = buildTraceSteps(detail.events);
    if (steps.length === 0) return;
    explorer.trace.value = { runId, steps };
    // The drawer becomes the trace inspector as soon as the replay starts.
    explorer.selectedNode.value = null;
    explorer.selectedEdge.value = null;
    explorer.drawerOpen.value = true;
    // Debugger semantics: the replay parks on the first node; step (or
    // play) walks the recorded path.
    startFlow(traceFlow(runId, `Replay · ${replayTitle(runId)}`, steps), {
      keepDrawer: true,
      paused: true,
    });
  } catch {
    // A failed fetch leaves the map untouched.
  }
};
