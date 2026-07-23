/**
 * Per-key concurrency semaphore (§7.1). `withGate` caps in-flight requests to the
 * LiteLLM gateway so a burst can't blow the provider's rate limit; combined with
 * transient retry it absorbs 429s (§20). Default cap is `max_parallel - 1`.
 */
export class Semaphore {
  private inUse = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  private async acquire(): Promise<void> {
    if (this.inUse < this.max) {
      this.inUse++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inUse++;
  }

  private release(): void {
    this.inUse--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get depth(): number {
    return this.waiters.length;
  }
}
