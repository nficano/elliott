import type { Digest } from "../core/types";
import type { RecordEvent } from "../core/waist/types";

export interface AuditCommitAdapter {
  commit(records: readonly RecordEvent[]): Promise<void>;
}

export interface CommitRequest {
  readonly records: readonly RecordEvent[];
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

export interface AuditCrossLink {
  readonly id: string;
  readonly timestamp: string;
  readonly shardHeads: Readonly<Record<string, Digest>>;
  readonly shardLengths: Readonly<Record<string, number>>;
  readonly merkleRoot: Digest;
  readonly previousRoot?: Digest;
  readonly digest: Digest;
}

export interface AuditSnapshot {
  readonly shards: Readonly<Record<string, readonly RecordEvent[]>>;
  readonly crossLinks: readonly AuditCrossLink[];
}

export interface AuditVerification {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface DurabilitySchema {
  readonly recordType: string;
  readonly durability: "effect-gating" | "observational";
  readonly policyDigest: Digest;
}
