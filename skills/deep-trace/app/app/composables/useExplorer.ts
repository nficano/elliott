import type { Engine } from "#shared/engine/engine";
import type { EngineState } from "#shared/engine/state";
import type {
  EdgeBrightness,
  ExplorerEdge,
  ExplorerNode,
  ExplorerPack,
  Flow,
  ViewMode,
} from "#shared/types/explorer";
import type { RawTopology } from "#shared/types/topology";
import type { InvocationItem, TraceStep } from "#shared/types/trace";
import type { Ref, ShallowRef } from "vue";

import { createEngineState } from "#shared/engine/state";
import { MAP_BASE } from "#shared/utils/base";
import { buildExplorerPack } from "#shared/utils/explorer-pack";

export type ExplorerStatus = "loading" | "ready" | "error";

export interface FlowUi {
  active: boolean;
  name: string;
  stepIndex: number;
  stepCount: number;
  playing: boolean;
  progress: number;
}

export interface TraceUi {
  readonly runId: string;
  readonly steps: readonly TraceStep[];
}

export interface HoverUi {
  node: ExplorerNode | null;
  edge: ExplorerEdge | null;
  x: number;
  y: number;
  shown: boolean;
}

export interface ExplorerStore {
  status: Ref<ExplorerStatus>;
  subtitle: Ref<string>;
  pack: ShallowRef<ExplorerPack | null>;
  viewMode: Ref<ViewMode>;
  edgeBrightness: Ref<EdgeBrightness>;
  selectedNode: ShallowRef<ExplorerNode | null>;
  selectedEdge: ShallowRef<ExplorerEdge | null>;
  drawerOpen: Ref<boolean>;
  hover: Ref<HoverUi>;
  flowUi: Ref<FlowUi>;
  invocations: ShallowRef<readonly InvocationItem[]>;
  trace: ShallowRef<TraceUi | null>;
  // The engine state is deliberately non-reactive; this mirror is what the
  // flow player template binds to.
  activeFlow: ShallowRef<Flow | null>;
  engineState: { value: EngineState | null; };
  engine: { value: Engine | null; };
}

const TOPOLOGY_FAILURE_SUBTITLE =
  "Topology unavailable — expected elliott-topology.enriched.json";
const LOADING_SUBTITLE = "Isometric map of the verified Elliott runtime — loading…";

// Module-scoped singleton (client-only SPA): every component shares one store.
const store: ExplorerStore = {
  status: ref<ExplorerStatus>("loading"),
  subtitle: ref(LOADING_SUBTITLE),
  pack: shallowRef<ExplorerPack | null>(null),
  viewMode: ref<ViewMode>("domains"),
  edgeBrightness: ref<EdgeBrightness>("dim"),
  selectedNode: shallowRef<ExplorerNode | null>(null),
  selectedEdge: shallowRef<ExplorerEdge | null>(null),
  drawerOpen: ref(false),
  // shallowRef: hover swaps whole objects and must preserve raw node/edge
  // identity (a deep ref would proxy them and break === checks).
  hover: shallowRef<HoverUi>({
    node: null,
    edge: null,
    x: 0,
    y: 0,
    shown: false,
  }),
  flowUi: ref<FlowUi>({
    active: false,
    name: "",
    stepIndex: 0,
    stepCount: 0,
    playing: true,
    progress: 0,
  }),
  invocations: shallowRef<readonly InvocationItem[]>([]),
  trace: shallowRef<TraceUi | null>(null),
  activeFlow: shallowRef<Flow | null>(null),
  engineState: { value: null },
  engine: { value: null },
};

const TOPOLOGY_SOURCES = [
  `${MAP_BASE}/topology`,
  "elliott-topology.enriched.json",
];

const fetchTopology = async (): Promise<RawTopology | null> => {
  for (const source of TOPOLOGY_SOURCES) {
    try {
      const response = await fetch(source);
      if (response.ok) return (await response.json()) as RawTopology;
    } catch {
      // Try the next source.
    }
  }
  return null;
};

export const loadExplorer = async (): Promise<void> => {
  if (store.status.value === "ready") return;
  const raw = await fetchTopology();
  if (!raw) {
    store.status.value = "error";
    store.subtitle.value = TOPOLOGY_FAILURE_SUBTITLE;
    return;
  }
  const pack = buildExplorerPack(raw);
  store.pack.value = pack;
  store.engineState.value = createEngineState(pack);
  (globalThis as { ELLIOTT_EXPLORER_DATA?: ExplorerPack; }).ELLIOTT_EXPLORER_DATA =
    pack;
  store.subtitle.value =
    `${pack.meta.title} · rev ${pack.meta.revision} · ${pack.meta.evidenceDate}`;
  store.status.value = "ready";
};

export const useExplorer = (): ExplorerStore => store;

// ---- actions ---------------------------------------------------------------

const closeDrawerState = (): void => {
  store.drawerOpen.value = false;
  store.selectedNode.value = null;
  store.selectedEdge.value = null;
  const state = store.engineState.value;
  if (state) {
    state.selected = null;
    state.selectedEdge = null;
  }
};

export const selectNode = (node: ExplorerNode): void => {
  const state = store.engineState.value;
  if (state) {
    state.selected = node;
    state.selectedEdge = null;
  }
  store.selectedNode.value = node;
  store.selectedEdge.value = null;
  store.drawerOpen.value = true;
};

export const selectEdge = (edge: ExplorerEdge): void => {
  const state = store.engineState.value;
  if (state) {
    state.selectedEdge = edge;
    state.selected = null;
  }
  store.selectedEdge.value = edge;
  store.selectedNode.value = null;
  store.drawerOpen.value = true;
};

export const clearSelection = (): void => {
  closeDrawerState();
};

export const setView = (mode: ViewMode): void => {
  store.viewMode.value = mode;
  const state = store.engineState.value;
  const engine = store.engine.value;
  if (!state || !engine) return;
  state.boardOff.clear();
  engine.applyView(mode, false);
  engine.resetView();
};

export const setEdgeBrightness = (value: EdgeBrightness): void => {
  store.edgeBrightness.value = value;
  const state = store.engineState.value;
  if (state) state.edgeBrightness = value;
};

const syncFlowUi = (flow: Flow | null): void => {
  const state = store.engineState.value;
  store.flowUi.value = flow === null || state === null
    ? { ...store.flowUi.value, active: false }
    : {
      active: true,
      name: flow.name,
      stepIndex: state.flowStep,
      stepCount: flow.steps.length,
      playing: state.flowPlaying,
      progress: store.flowUi.value.progress,
    };
};

export const startFlow = (
  flow: Flow,
  options: { keepDrawer?: boolean; paused?: boolean; } = {},
): void => {
  const state = store.engineState.value;
  if (!state) return;
  state.flow = flow;
  state.flowStep = 0;
  state.flowT = 0;
  state.flowPlaying = options.paused !== true;
  state.flowNodes = new Set(
    flow.steps.flatMap((step) => [step.from, step.to]),
  );
  if (options.keepDrawer !== true) closeDrawerState();
  store.activeFlow.value = flow;
  store.flowUi.value.progress = 0;
  syncFlowUi(flow);
};

export const exitFlow = (): void => {
  const state = store.engineState.value;
  if (state) state.flow = null;
  store.activeFlow.value = null;
  if (store.trace.value !== null) {
    store.trace.value = null;
    closeDrawerState();
  }
  syncFlowUi(null);
};

export const flowAdvance = (dir: number): void => {
  const state = store.engineState.value;
  const flow = state?.flow;
  if (!state || !flow) return;
  state.flowStep = (state.flowStep + dir + flow.steps.length)
    % flow.steps.length;
  state.flowT = 0;
  syncFlowUi(flow);
};

export const flowTogglePlay = (): void => {
  const state = store.engineState.value;
  const flow = state?.flow;
  if (!state || !flow) return;
  const atEnd = !state.flowPlaying
    && state.flowStep === flow.steps.length - 1 && state.flowT >= 1;
  if (atEnd) {
    state.flowStep = 0;
    state.flowT = 0;
  }
  state.flowPlaying = !state.flowPlaying;
  syncFlowUi(flow);
};

export const flowPause = (): void => {
  const state = store.engineState.value;
  if (state?.flow && state.flowPlaying) {
    state.flowPlaying = false;
    syncFlowUi(state.flow);
  }
};

export const flowFinished = (): void => {
  const state = store.engineState.value;
  if (!state?.flow) return;
  store.flowUi.value.progress = 1;
  syncFlowUi(state.flow);
};

export const flowProgress = (progress: number): void => {
  store.flowUi.value.progress = progress;
};
