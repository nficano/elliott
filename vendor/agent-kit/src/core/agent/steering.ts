import type { SteeringChannel } from "../../host/runtime/types.js";

const DEFAULT_STEERING_CAPACITY = 8;

/**
 * Steering channel (§7.3): a bounded FIFO per turn (cap ~8; overflow drops
 * oldest with a metric). Drained ALL at each round boundary (arrival order
 * preserved); never drained mid-round; appended after the complete tool-result
 * block (tool-pair invariant, §10.4).
 */
export class BoundedSteering implements SteeringChannel {
  private readonly q: string[] = [];
  private _dropped = 0;

  constructor(private readonly cap = DEFAULT_STEERING_CAPACITY) {}

  push(...texts: string[]): void {
    for (const text of texts) {
      this.q.push(text);
      while (this.q.length > this.cap) {
        this.q.shift();
        this._dropped++;
      }
    }
  }

  drain(): string[] {
    const all = [...this.q];
    this.q.length = 0;
    return all;
  }

  get dropped(): number {
    return this._dropped;
  }
}
