import type {
  Board,
  EdgeBrightness,
  EdgeKindStyle,
  ExplorerEdge,
  ExplorerNode,
  ExplorerPack,
  Flow,
  ViewMode,
} from "../types/explorer";

import { EDGE_COLOR } from "../utils/palette";

// Mutable, non-reactive scene state. Vue components mutate it through the
// store composable; the render loop reads it every frame. Keeping it outside
// Vue's reactivity avoids proxy overhead in the per-frame hot path.
export interface EngineState {
  pack: ExplorerPack;
  nodesById: Map<string, ExplorerNode>;
  edgesByNode: Map<string, ExplorerEdge[]>;
  edgeStyle: Map<string, EdgeKindStyle>;
  boards: Board[];
  viewMode: ViewMode;
  labels: boolean;
  zones: boolean;
  particles: boolean;
  focusDim: boolean;
  edgeBrightness: EdgeBrightness;
  boardOff: Set<string>;
  edgeKindOff: Set<string>;
  hovered: ExplorerNode | null;
  hoveredEdge: ExplorerEdge | null;
  selected: ExplorerNode | null;
  selectedEdge: ExplorerEdge | null;
  flow: Flow | null;
  flowStep: number;
  flowT: number;
  flowPlaying: boolean;
  flowNodes: Set<string>;
}

export const createEngineState = (pack: ExplorerPack): EngineState => {
  const nodesById = new Map(pack.nodes.map((node) => [node.id, node]));
  const edgesByNode = new Map<string, ExplorerEdge[]>();
  for (const edge of pack.edges) {
    for (const endpoint of [edge.from, edge.to]) {
      const bucket = edgesByNode.get(endpoint);
      if (bucket === undefined) edgesByNode.set(endpoint, [edge]);
      else bucket.push(edge);
    }
  }
  const edgeStyle = new Map<string, EdgeKindStyle>();
  for (const [kind, style] of Object.entries(pack.rendering.edgeKindStyles)) {
    edgeStyle.set(kind, { ...style, color: EDGE_COLOR[kind] ?? style.color });
  }
  return {
    pack,
    nodesById,
    edgesByNode,
    edgeStyle,
    boards: [],
    viewMode: "domains",
    labels: true,
    zones: true,
    particles: false,
    focusDim: true,
    edgeBrightness: "dim",
    boardOff: new Set(),
    edgeKindOff: new Set(),
    hovered: null,
    hoveredEdge: null,
    selected: null,
    selectedEdge: null,
    flow: null,
    flowStep: 0,
    flowT: 0,
    flowPlaying: true,
    flowNodes: new Set(),
  };
};

export const visibleSourceNodes = (
  state: EngineState,
): ExplorerNode[] => [...state.pack.nodes];

export const updateVisibility = (state: EngineState): void => {
  for (const node of state.pack.nodes) {
    node.rs.visible = node.board !== null && node.board !== undefined
      && !state.boardOff.has(node.board.id);
  }
};

export const edgeVisible = (
  state: EngineState,
  edge: ExplorerEdge,
): boolean => {
  if (state.edgeKindOff.has(edge.kind)) return false;
  const a = state.nodesById.get(edge.from);
  const b = state.nodesById.get(edge.to);
  return a !== undefined && b !== undefined && a.rs.visible && b.rs.visible;
};

// The set of node ids that stay bright: the active flow, the selection or
// hover neighborhood, or null when nothing narrows focus.
export const focusSet = (state: EngineState): Set<string> | null => {
  if (state.flow) return state.flowNodes;
  if (!state.focusDim) return null;
  if (state.selectedEdge) {
    return new Set([state.selectedEdge.from, state.selectedEdge.to]);
  }
  if (state.hoveredEdge) {
    return new Set([state.hoveredEdge.from, state.hoveredEdge.to]);
  }
  const node = state.selected ?? state.hovered;
  if (!node) return null;
  const set = new Set([node.id]);
  for (const edge of state.edgesByNode.get(node.id) ?? []) {
    set.add(edge.from);
    set.add(edge.to);
  }
  return set;
};

export const effectiveBrightness = (state: EngineState): EdgeBrightness =>
  state.flow ? "bright" : state.edgeBrightness;
