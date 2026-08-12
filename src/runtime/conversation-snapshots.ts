export class RuntimeConversationSnapshots {
  readonly #snapshots = new Map<string, string>();

  resolve(
    conversation: string,
    currentSnapshotId: string,
    retain: boolean,
  ): string {
    if (!retain) {
      this.#snapshots.delete(conversation);
      return currentSnapshotId;
    }
    const existing = this.#snapshots.get(conversation);
    if (existing !== undefined) return existing;
    this.#snapshots.set(conversation, currentSnapshotId);
    return currentSnapshotId;
  }

  clear(): void {
    this.#snapshots.clear();
  }
}
