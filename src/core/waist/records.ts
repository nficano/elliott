import { hashValue, newId } from "../digest";
import type { Digest } from "../types";
import type { RecordAppender, RecordDraft, RecordEvent } from "./types";

/** Assembles a frozen, hash-chained record event from a draft plus injected
 *  identity/time/head. Pure: the digest folds in `previousDigest`, and the
 *  `previousDigest` field is present only when the chain has a head. */
export const buildRecordEvent = (
  draft: RecordDraft,
  ctx: {
    readonly id: string;
    readonly timestamp: string;
    readonly previousDigest: Digest | undefined;
  },
): RecordEvent => {
  const payload = Object.freeze({ ...draft.payload });
  const eventDigest = hashValue({
    id: ctx.id,
    type: draft.type,
    scope: draft.scope,
    durability: draft.durability,
    classification: draft.classification,
    timestamp: ctx.timestamp,
    payload,
    previousDigest: ctx.previousDigest,
  });
  const common = {
    id: ctx.id,
    type: draft.type,
    scope: draft.scope,
    durability: draft.durability,
    classification: draft.classification,
    timestamp: ctx.timestamp,
    payload,
    digest: eventDigest,
  };
  return ctx.previousDigest === undefined
    ? Object.freeze(common)
    : Object.freeze({ ...common, previousDigest: ctx.previousDigest });
};

export class MemoryRecordAppender implements RecordAppender {
  readonly #events: RecordEvent[] = [];
  #head: Digest | undefined;

  async append(draft: RecordDraft): Promise<RecordEvent> {
    const event = buildRecordEvent(draft, {
      id: draft.id ?? newId("rec"),
      timestamp: draft.timestamp ?? new Date().toISOString(),
      previousDigest: this.#head,
    });
    this.#events.push(event);
    this.#head = event.digest;
    return event;
  }

  list(): readonly RecordEvent[] {
    return [...this.#events];
  }
}
