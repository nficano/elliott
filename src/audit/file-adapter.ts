import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RecordEvent } from "../core/waist/types";
import type { AuditCommitAdapter } from "./types";

// Durable, append-only sink for committed audit records. AuditLog already
// hash-chains every record to its shard predecessor and Merkle-cross-links the
// shard heads, so a flat append-only file is tamper-evident on its own: any
// edit, reorder, or truncation breaks verifyAuditRecord (or the cross-link
// roots) when the file is replayed through AuditLog.verify. One JSON object per
// line so the trail survives process restarts and can be streamed back.
export class FileCommitAdapter implements AuditCommitAdapter {
  #chain: Promise<void> = Promise.resolve();
  #ensured = false;

  constructor(readonly filePath: string) {}

  commit(records: readonly RecordEvent[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    const payload = records.map((record) => JSON.stringify(record)).join("\n")
      + "\n";
    // Serialize appends so concurrent group commits cannot interleave lines,
    // and keep the internal chain from latching into a permanently-rejected
    // state when one write fails — the failure still propagates to its caller.
    const write = this.#chain.then(() => this.#append(payload));
    this.#chain = write.catch(() => undefined);
    return write;
  }

  async #append(payload: string): Promise<void> {
    if (!this.#ensured) {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      this.#ensured = true;
    }
    await appendFile(this.filePath, payload);
  }
}
