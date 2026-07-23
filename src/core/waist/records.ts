import { hashValue, newId } from "../digest";
import type { Digest } from "../types";
import type { RecordAppender, RecordDraft, RecordEvent } from "./types";

export class MemoryRecordAppender implements RecordAppender {
  readonly #events: RecordEvent[] = [];
  #head: Digest | undefined;

  async append(draft: RecordDraft): Promise<RecordEvent> {
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
      previousDigest: this.#head,
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
    const event = this.#head === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, previousDigest: this.#head });
    this.#events.push(event);
    this.#head = eventDigest;
    return event;
  }

  list(): readonly RecordEvent[] {
    return [...this.#events];
  }
}
