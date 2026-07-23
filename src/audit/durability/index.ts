import type { RecordEvent } from "../../core/waist/types";
import type {
  AuditCommitAdapter,
  CommitRequest,
  DurabilitySchema,
} from "../types";

export class MemoryCommitAdapter implements AuditCommitAdapter {
  readonly #committed = new Set<string>();

  async commit(records: readonly RecordEvent[]): Promise<void> {
    for (const record of records) this.#committed.add(record.id);
  }

  has(recordId: string): boolean {
    return this.#committed.has(recordId);
  }
}

export class GroupCommitter {
  readonly #pending: CommitRequest[] = [];
  #scheduled = false;

  constructor(readonly adapter: AuditCommitAdapter) {}

  enqueue(records: readonly RecordEvent[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#pending.push({ records, resolve, reject });
      if (this.#scheduled) return;
      this.#scheduled = true;
      queueMicrotask(() => {
        void this.#flush();
      });
    });
  }

  async #flush(): Promise<void> {
    const requests = [...this.#pending];
    this.#pending.length = 0;
    this.#scheduled = false;
    const records = requests.flatMap((request) => request.records);
    try {
      await this.adapter.commit(records);
      for (const request of requests) request.resolve();
    } catch (error) {
      for (const request of requests) request.reject(error);
    }
  }
}

export class DurabilitySchemaRegistry {
  readonly #schemas = new Map<string, DurabilitySchema>();

  register(schema: DurabilitySchema): void {
    const existing = this.#schemas.get(schema.recordType);
    if (
      existing !== undefined
      && (existing.durability !== schema.durability
        || existing.policyDigest !== schema.policyDigest)
    ) throw new Error(`Durability schema conflict for ${schema.recordType}`);
    this.#schemas.set(schema.recordType, Object.freeze(schema));
  }

  validate(record: RecordEvent): void {
    const schema = this.#schemas.get(record.type);
    if (schema !== undefined && schema.durability !== record.durability) {
      throw new Error(`Invalid durability class for ${record.type}`);
    }
  }
}
