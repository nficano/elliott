import { hashValue, newId } from "../../core/digest";
import type { Digest } from "../../core/types";
import type { RecordDraft, RecordEvent } from "../../core/waist/types";

const shardClass = (type: string): string => type.split(".", 1)[0] ?? type;

export const auditShardKey = (draft: RecordDraft): string =>
  `${draft.scope.level}:${draft.scope.id}:${shardClass(draft.type)}`;

export const createAuditRecord = (
  draft: RecordDraft,
  previousDigest?: Digest,
): RecordEvent => {
  const id = draft.id ?? newId("rec");
  const timestamp = draft.timestamp ?? new Date().toISOString();
  const payload = Object.freeze({ ...draft.payload });
  const eventDigest = hashValue({
    id,
    type: draft.type,
    scope: draft.scope,
    durability: draft.durability,
    classification: draft.classification,
    timestamp,
    payload,
    previousDigest,
  });
  const common = {
    id,
    type: draft.type,
    scope: draft.scope,
    durability: draft.durability,
    classification: draft.classification,
    timestamp,
    payload,
    digest: eventDigest,
  };
  return previousDigest === undefined
    ? Object.freeze(common)
    : Object.freeze({ ...common, previousDigest });
};

export const verifyAuditRecord = (
  record: RecordEvent,
  expectedPrevious?: Digest,
): boolean =>
  record.previousDigest === expectedPrevious
  && record.digest === hashValue({
      id: record.id,
      type: record.type,
      scope: record.scope,
      durability: record.durability,
      classification: record.classification,
      timestamp: record.timestamp,
      payload: record.payload,
      previousDigest: expectedPrevious,
    });
