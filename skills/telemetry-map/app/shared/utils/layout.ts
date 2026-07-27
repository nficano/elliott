import type {
  Board,
  Cluster,
  ExplorerNode,
  ExplorerPack,
  ViewMode,
} from "../types/explorer";

import { CANVAS_COLOR, DOMAIN_COLOR } from "./palette";

export const UNIFORM_NODE_FOOT = 1.62;
export const SYSTEM_FOOTPRINT_WIDTH = 1.12;
export const UNIFORM_NODE_HEIGHT = 0.66;
export const MIN_NODE_CLEARANCE = 1.15;
export const GROUND_GRID_STEP = 6.6;
const BOARD_PAD = 2.8;
const LAYER_SPACING_Y = 7.6;
const MIN_DOMAIN_BOARD = 3;

export const nodeFoot = (): number => UNIFORM_NODE_FOOT;
export const nodeHeight = (): number => UNIFORM_NODE_HEIGHT;

export const nodeLayoutSpan = (): { w: number; d: number; } => ({
  w: UNIFORM_NODE_FOOT * SYSTEM_FOOTPRINT_WIDTH,
  d: UNIFORM_NODE_FOOT * 0.72,
});

interface GridResult {
  cols: number;
  rows: number;
  w: number;
  d: number;
  x: number[];
  z: number[];
}

// Pack nodes into a near-`aspect` grid; column/row sizes fit the widest node.
export const gridPositions = (
  nodes: readonly ExplorerNode[],
  aspect = 1.35,
): GridResult => {
  const cols = Math.max(1, Math.round(Math.sqrt(nodes.length * aspect)));
  const rows = Math.ceil(nodes.length / cols);
  const colWidths = Array.from({ length: cols }, () => 0);
  const rowDepths = Array.from({ length: rows }, () => 0);
  for (let i = 0; i < nodes.length; i += 1) {
    const span = nodeLayoutSpan();
    const col = i % cols;
    const row = Math.trunc(i / cols);
    colWidths[col] = Math.max(colWidths[col] ?? 0, span.w);
    rowDepths[row] = Math.max(rowDepths[row] ?? 0, span.d);
  }
  const centers = (sizes: number[]): { positions: number[]; total: number; } => {
    const positions: number[] = [];
    let cursor = 0;
    for (const size of sizes) {
      positions.push(cursor + size / 2);
      cursor += size + MIN_NODE_CLEARANCE;
    }
    return { positions, total: Math.max(0, cursor - MIN_NODE_CLEARANCE) };
  };
  const x = centers(colWidths);
  const z = centers(rowDepths);
  return { cols, rows, w: x.total, d: z.total, x: x.positions, z: z.positions };
};

interface Packable {
  w: number;
  d: number;
  x: number;
  z: number;
}

// Shelf-pack rectangles into a container of target aspect (in place).
export const shelfPack = (
  items: readonly Packable[],
  gap: number,
  targetAspect = 2.2,
): { w: number; d: number; } => {
  const area = items.reduce(
    (sum, item) => sum + (item.w + gap) * (item.d + gap),
    0,
  );
  const targetW = Math.sqrt(area * targetAspect) * 1.02;
  let x = 0;
  let z = 0;
  let rowD = 0;
  let maxW = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > targetW) {
      x = 0;
      z += rowD + gap;
      rowD = 0;
    }
    item.x = x + item.w / 2;
    item.z = z + item.d / 2;
    x += item.w + gap;
    rowD = Math.max(rowD, item.d);
    maxW = Math.max(maxW, x - gap);
  }
  const totalD = z + rowD;
  for (const item of items) {
    item.x -= maxW / 2;
    item.z -= totalD / 2;
  }
  return { w: maxW, d: totalD };
};

export const clusterize = (
  nodes: readonly ExplorerNode[],
  keyFn: (node: ExplorerNode) => string,
): Map<string, ExplorerNode[]> => {
  const map = new Map<string, ExplorerNode[]>();
  for (const node of nodes) {
    const key = keyFn(node) || "other";
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [node]);
    else bucket.push(node);
  }
  return map;
};

const buildClusters = (
  nodes: readonly ExplorerNode[],
  clusterKeyFn: (node: ExplorerNode) => string,
): Cluster[] => {
  const clusters: Cluster[] = [];
  for (const [key, clusterNodes] of clusterize(nodes, clusterKeyFn)) {
    clusterNodes.sort((a, b) =>
      (a.visual.order || 99) - (b.visual.order || 99)
      || a.name.localeCompare(b.name)
    );
    const grid = gridPositions(clusterNodes, 1.5);
    clusters.push({
      key,
      nodes: clusterNodes,
      w: grid.w,
      d: grid.d,
      cols: grid.cols,
      xPositions: grid.x,
      zPositions: grid.z,
      x: 0,
      z: 0,
    });
  }
  clusters.sort((a, b) =>
    Math.min(...a.nodes.map((n) => n.visual.order || 99))
      - Math.min(...b.nodes.map((n) => n.visual.order || 99))
    || b.nodes.length - a.nodes.length
  );
  return clusters;
};

// One platform slab holding clustered nodes; assigns node-local lx/lz.
export const buildBoard = (
  identity: { id: string; name: string; hint: string; color: string; },
  nodes: readonly ExplorerNode[],
  clusterKeyFn: (node: ExplorerNode) => string,
  clusterAspect = 2.3,
): Board => {
  const clusters = buildClusters(nodes, clusterKeyFn);
  const inner = shelfPack(clusters, 1.55, clusterAspect);
  for (const cluster of clusters) {
    for (const [i, node] of cluster.nodes.entries()) {
      const col = i % cluster.cols;
      const row = Math.trunc(i / cluster.cols);
      node.lx = cluster.x - cluster.w / 2 + (cluster.xPositions[col] ?? 0);
      node.lz = cluster.z - cluster.d / 2 + (cluster.zPositions[row] ?? 0);
    }
  }
  return {
    ...identity,
    clusters,
    w: inner.w + BOARD_PAD * 2,
    d: inner.d + BOARD_PAD * 2,
    x: 0,
    y: 0,
    z: 0,
    count: nodes.length,
    alpha: 0,
    tAlpha: 1,
  };
};

interface BoardGroup {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly color: string;
  readonly nodes: readonly ExplorerNode[];
}

const layoutBoardsGround = (groups: readonly BoardGroup[]): Board[] => {
  const boards = groups
    .filter((group) => group.nodes.length > 0)
    .map((group) =>
      buildBoard(group, group.nodes, () => "all", 1.6)
    );
  shelfPack(boards, 6.5, 1.9);
  for (const board of boards) board.y = 0;
  return boards;
};

export const layoutLayers = (
  pack: ExplorerPack,
  sourceNodes: readonly ExplorerNode[],
): Board[] => {
  const boards: Board[] = [];
  const ordered = [...pack.layers].sort((a, b) => b.z - a.z);
  for (const layer of ordered) {
    const nodes = sourceNodes.filter((n) => n.visual.layer === layer.id);
    if (nodes.length === 0) continue;
    const board = buildBoard(
      {
        id: layer.id,
        name: layer.name,
        hint: layer.purpose,
        color: CANVAS_COLOR.layer,
      },
      nodes,
      () => "all",
      2.1,
    );
    board.layerZ = layer.z;
    boards.push(board);
  }
  const stacked = [...boards].sort(
    (a, b) => (b.layerZ ?? 0) - (a.layerZ ?? 0),
  );
  const count = stacked.length;
  const maxW = Math.max(...stacked.map((b) => b.w));
  const maxD = Math.max(...stacked.map((b) => b.d));
  for (const [j, board] of stacked.entries()) {
    board.w = maxW;
    board.d = maxD;
    board.y = (count - 1 - j) * LAYER_SPACING_Y;
    board.x = 0;
    board.z = 0;
  }
  return boards;
};

export const layoutDomains = (
  pack: ExplorerPack,
  sourceNodes: readonly ExplorerNode[],
): Board[] => {
  const counts: Record<string, number> = {};
  for (const node of sourceNodes) {
    counts[node.domain] = (counts[node.domain] ?? 0) + 1;
  }
  const majors = Object.keys(counts)
    .filter((domain) => (counts[domain] ?? 0) >= MIN_DOMAIN_BOARD)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  const groups: BoardGroup[] = majors.map((domain) => ({
    id: `dom:${domain}`,
    name: pack.domains.find((d) => d.id === domain)?.title
      ?? (domain[0] ?? "").toUpperCase() + domain.slice(1),
    hint: `${counts[domain]} components`,
    color: DOMAIN_COLOR[domain] ?? CANVAS_COLOR.domainFallback,
    nodes: sourceNodes.filter((n) => n.domain === domain),
  }));
  const rest = sourceNodes.filter(
    (n) => (counts[n.domain] ?? 0) < MIN_DOMAIN_BOARD,
  );
  if (rest.length > 0) {
    groups.push({
      id: "dom:shared",
      name: "Shared / other",
      hint: `${rest.length} components`,
      color: CANVAS_COLOR.boardNeutral,
      nodes: rest,
    });
  }
  return layoutBoardsGround(groups);
};

export const layoutDeploy = (
  pack: ExplorerPack,
  sourceNodes: readonly ExplorerNode[],
): Board[] =>
  layoutBoardsGround(
    pack.hosts.map((host) => ({
      id: `host:${host.id}`,
      name: host.name,
      hint: host.hint,
      color: host.color,
      nodes: sourceNodes.filter((n) => n.host === host.id),
    })),
  );

export const layoutView = (
  mode: ViewMode,
  pack: ExplorerPack,
  sourceNodes: readonly ExplorerNode[],
): Board[] =>
  mode === "layers"
    ? layoutLayers(pack, sourceNodes)
    : (mode === "domains"
    ? layoutDomains(pack, sourceNodes)
    : layoutDeploy(pack, sourceNodes));
