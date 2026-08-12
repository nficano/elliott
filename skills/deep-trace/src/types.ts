import type {
  JsonRecord,
  RouteBinding,
  SkillPackageView,
  StoredGrant,
} from "../../../src/runtime/skills/types";
import type { TelemetryEnvelope } from "../../../src/runtime/types";

export interface DbTableStat {
  readonly table: string;
  readonly count: number;
  readonly delta: number;
}

export interface DbSnapshot {
  readonly at: string;
  readonly tables: readonly DbTableStat[];
  readonly recent: Readonly<Record<string, readonly unknown[]>>;
}

export interface TailDelta {
  readonly table: string;
  readonly count: number;
  readonly delta: number;
}

export type TailListener = (
  snapshot: DbSnapshot,
  deltas: readonly TailDelta[],
) => void;

export type ClientListener = (event: TelemetryEnvelope) => void;

export type TelemetryPayload = Readonly<Record<string, unknown>>;

export interface DbCollected {
  readonly snapshot: DbSnapshot;
  readonly deltas: readonly TailDelta[];
}

export interface RunSummary {
  readonly runId: string;
  gateway?: string;
  sender?: string;
  channel?: string;
  text?: string;
  conversation?: string;
  rounds: number;
  tools: number;
  toolErrors: number;
  routeDigest?: string;
  disposition?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface MapMeta {
  readonly environment: string;
  readonly release: string;
  readonly configuredModel: string;
  readonly promptsEnabled: boolean;
}

export interface MapSnapshot {
  readonly generatedAt: string;
  readonly meta: MapMeta;
  readonly db: DbSnapshot;
  readonly turns: readonly RunSummary[];
  readonly events: readonly TelemetryEnvelope[];
}

export interface TurnDetail {
  readonly runId: string;
  readonly events: readonly TelemetryEnvelope[];
}

export interface AppDistRoutes {
  readonly routes: readonly RouteBinding[];
  readonly index: (() => Promise<Response>) | undefined;
}

export interface MapHealth extends Readonly<Record<string, number>> {
  readonly turns: number;
  readonly events: number;
  readonly clients: number;
  readonly dbTables: number;
}

export interface AutoEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly protocol: string;
  readonly label: string;
}

export interface ManifestTopology {
  readonly node: JsonRecord;
  readonly nodeId: string;
  readonly dispatch?: string;
  readonly edges: readonly JsonRecord[];
  readonly egressTargets: readonly string[];
}

export interface Candidate {
  readonly view: SkillPackageView;
  readonly topology: ManifestTopology;
}

export interface MergeInput {
  readonly base: string;
  readonly packages: readonly SkillPackageView[];
  readonly grants: readonly StoredGrant[];
}

export interface ParsedDocument {
  readonly raw: JsonRecord;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly domains: readonly unknown[];
}

export interface MergeState {
  readonly nodesOut: unknown[];
  readonly edgesOut: unknown[];
  readonly nodeIds: Set<string>;
  readonly summary: {
    readonly nodes: string[];
    readonly edges: string[];
    readonly liveness: Record<string, string>;
  };
}
