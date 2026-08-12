import type { ClassificationStamp, Posture } from "../config/postures/types";
import type {
  ComponentRef,
  DataClassification,
  Digest,
  PrincipalId,
} from "../core/types";
import type { CompanionDeclaration } from "../placement/types";

export type CuratedMemoryDocument = "MEMORY.md" | "USER.md";
export type CuratedMemoryAction = "add" | "replace" | "remove";

export interface MemoryProvenance {
  readonly source: ComponentRef;
  readonly originalRecord?: Digest;
}

export interface CuratedMemoryEntry {
  readonly id: Digest;
  readonly document: CuratedMemoryDocument;
  readonly content: string;
  readonly stamp: ClassificationStamp;
  readonly provenance: MemoryProvenance;
  readonly createdAt: string;
}

export interface CuratedMemoryMutation {
  readonly action: CuratedMemoryAction;
  readonly document: CuratedMemoryDocument;
  readonly content: string;
  readonly match?: string;
  readonly classification: DataClassification;
  readonly provenance: MemoryProvenance;
}

export interface CuratedMemorySnapshot {
  readonly sessionId: string;
  readonly prefix: string;
  readonly entries: readonly CuratedMemoryEntry[];
}

export interface CuratedMemoryPersistence {
  load(): Promise<readonly CuratedMemoryEntry[]>;
  save(entries: readonly CuratedMemoryEntry[]): Promise<void>;
}

export interface CuratedMemoryConfig {
  readonly maximumCharacters: Readonly<Record<CuratedMemoryDocument, number>>;
  readonly posture: () => Posture;
  readonly persistence: CuratedMemoryPersistence;
}

export interface SessionRecord {
  readonly id: string;
  readonly source: string;
  readonly principal: PrincipalId;
  readonly parentId?: string;
  readonly createdAt: string;
}

export interface SessionMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: string;
  readonly content: string;
  readonly classification: DataClassification;
  readonly createdAt: string;
}

export interface SessionUsage {
  readonly sessionId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface SessionAnalytics {
  readonly sessions: number;
  readonly messages: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface SessionRunEvidence {
  readonly id: string;
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly agentRef: string;
  readonly disposition: "success" | "failure" | "cancelled" | "unknown";
  readonly startedAt: string;
  readonly finishedAt?: string;
}

export interface ComponentUseEvidence {
  readonly id: string;
  readonly runId: string;
  readonly componentRef: string;
  readonly componentDigest: string;
  readonly operation: string;
  readonly outcome: "success" | "failure" | "unknown";
  readonly createdAt: string;
}

export interface ToolCallEvidence {
  readonly id: string;
  readonly runId: string;
  readonly requestedTool?: string;
  readonly selectedTool?: string;
  readonly schemaDigest: string;
  readonly argumentsDigest?: string;
  readonly resultDigest?: string;
  readonly latencyMilliseconds: number;
  readonly errorTag?: string;
  readonly createdAt: string;
}

export interface ToolFailureEvidenceSummary {
  readonly failures: readonly ToolCallEvidence[];
  readonly totalCalls: number;
}

export interface FeedbackEvidence {
  readonly id: string;
  readonly runId: string;
  readonly targetRef: string;
  readonly kind:
    | "explicit-correction"
    | "confirmed-success"
    | "confirmed-failure";
  readonly evidenceDigest: string;
  readonly createdAt: string;
}

export interface EvaluationLabelEvidence {
  readonly id: string;
  readonly runId: string;
  readonly evaluatorRef: string;
  readonly rubricDigest: string;
  readonly score: number;
  readonly confidence: number;
  readonly source: string;
  readonly createdAt: string;
}

export interface ModelSelectionEvidence {
  readonly id: string;
  readonly runId: string;
  readonly routeDigest: string;
  readonly usageReference: string;
  readonly createdAt: string;
}

export interface ScheduledJobRow {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  readonly requestedCapabilities: string;
  readonly runAt: string;
  readonly payload: string;
  readonly recurrence: string | null;
  readonly retryAttempt: number | null;
}

export interface ExternalMemoryRecord {
  readonly subject: string;
  readonly statement: string;
  readonly scope: string;
  readonly confidence: number;
  readonly stamp: ClassificationStamp;
}

export interface ExternalMemoryProvider {
  readonly ref: ComponentRef;
  readonly companion?: CompanionDeclaration;
  initialize(): Promise<void>;
  systemPromptBlock(): Promise<string>;
  prefetch(query: string): Promise<readonly ExternalMemoryRecord[]>;
  syncTurn(sessionId: string): Promise<void>;
  onPreCompress(sessionId: string): Promise<void>;
  onSessionEnd(sessionId: string): Promise<void>;
  toolSchemas(): readonly Readonly<Record<string, unknown>>[];
}
