import type { RawDomain, RawEdge, RawNode } from "./topology";

// The explorer pack is the view model the scene renders: raw topology nodes
// and edges enriched with layout, palette, and narrative fields. It matches
// the structure the legacy ui.html built (window.ELLIOTT_EXPLORER_DATA).

export interface SourceRef {
  readonly path: string;
  readonly purpose: string;
}

export interface NodeDetail {
  readonly interfaces: string;
  readonly dataOwnership: readonly string[];
  readonly failureModes: string;
  readonly observability: readonly string[];
}

export interface NodeRuntime {
  readonly models: readonly string[];
  readonly languages: readonly string[];
  readonly regions: readonly string[];
  readonly lifecycle: "active" | "migration" | "inactive";
  readonly state: string;
}

export interface NodeVisual {
  readonly size: string;
  readonly layer: string;
  readonly cluster: string;
  readonly order: number;
  readonly shapeClass: "database" | "system";
}

export interface NodeHover {
  readonly summary: string;
  readonly badges: readonly string[];
}

// Mutable per-frame render state attached to each node by the engine.
export interface NodeRenderState {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  depth: number;
  r: number;
  alpha: number;
  birth: number;
  visible: boolean;
  paintAlpha: number;
}

export interface ExplorerNode {
  readonly id: string;
  readonly name: string;
  readonly fullName?: string;
  readonly kind?: string;
  readonly domain: string;
  readonly host: string;
  readonly runtimeState: string;
  readonly responsibility: string;
  readonly capabilities: readonly string[];
  readonly hover: NodeHover;
  readonly authority: string;
  readonly authorityDetail: string;
  readonly confidence: string;
  readonly dataClassifications: readonly string[];
  readonly scaling: string;
  readonly security: readonly string[];
  readonly operability: string;
  readonly designRationale: string;
  readonly detail: NodeDetail;
  readonly runtime: NodeRuntime;
  readonly sourceRefs: readonly SourceRef[];
  readonly characteristics: readonly string[];
  readonly visual: NodeVisual;
  readonly original: RawNode;
  rs: NodeRenderState;
  board?: Board | null;
  lx?: number;
  lz?: number;
}

export interface EdgeMotion {
  readonly count: number;
  readonly speed: number;
  readonly size: number;
}

export interface ExplorerEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly mode: string;
  readonly purpose: string;
  readonly protocol: string;
  readonly routeOrSubject: string;
  readonly data: readonly string[];
  readonly dataClassifications: readonly string[];
  readonly consistency: string;
  readonly failureHandling: string;
  readonly security: string;
  readonly confidence: string;
  readonly motion: EdgeMotion;
  readonly evidence: string;
  readonly original: RawEdge;
}

export interface FlowStep {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  readonly data: readonly string[];
  readonly transport: string;
  readonly result: string;
}

export interface Flow {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly FlowStep[];
  readonly consistencyNotes: readonly string[];
  readonly failurePoints: readonly string[];
}

export interface HostZone {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  color: string;
}

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly z: number;
}

export interface PackMeta {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  readonly revision: string;
  readonly evidenceDate: string;
  readonly summary: string;
  readonly philosophy: string;
  readonly assumptions: readonly string[];
  readonly decisions: readonly string[];
  readonly qualityAttributes: Readonly<Record<string, unknown>>;
  readonly limitations: unknown;
}

export interface EdgeKindStyle {
  readonly color: string;
  readonly width: number;
  readonly dash: boolean;
}

export interface PackRendering {
  readonly domainPalette: Readonly<Record<string, string>>;
  readonly edgeKindStyles: Readonly<Record<string, EdgeKindStyle>>;
}

export interface ExplorerPack {
  readonly meta: PackMeta;
  readonly nodes: readonly ExplorerNode[];
  readonly edges: readonly ExplorerEdge[];
  readonly flows: readonly Flow[];
  readonly hosts: readonly HostZone[];
  readonly layers: readonly Layer[];
  readonly domains: readonly RawDomain[];
  readonly rendering: PackRendering;
}

// ---- layout ---------------------------------------------------------------

export interface Cluster {
  readonly key: string;
  readonly nodes: readonly ExplorerNode[];
  readonly w: number;
  readonly d: number;
  readonly cols: number;
  readonly xPositions: readonly number[];
  readonly zPositions: readonly number[];
  x: number;
  z: number;
}

export interface Board {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly color: string;
  readonly clusters: readonly Cluster[];
  readonly count: number;
  w: number;
  d: number;
  x: number;
  y: number;
  z: number;
  layerZ?: number;
  alpha: number;
  tAlpha: number;
  depth?: number;
}

export type ViewMode = "domains" | "deploy" | "layers";

export type EdgeBrightness = "off" | "dim" | "bright";
