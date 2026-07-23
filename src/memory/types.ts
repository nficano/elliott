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

export interface ScheduledJobRow {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  readonly requestedCapabilities: string;
  readonly runAt: string;
  readonly payload: string;
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
