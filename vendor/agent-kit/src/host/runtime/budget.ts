import { BudgetExceeded } from "../../core/errors.js";
import { type Usage } from "../../core/types.js";
import type { BudgetAccumulator } from "./types.js";

const USD_DECIMAL_PLACES = 4;

/**
 * Per-turn budget guard (§11). Accumulates spend and throws `BudgetExceeded`
 * once the per-turn USD cap is breached mid-turn (§20 "token budget exhausted
 * mid-turn"). The monthly cap + footprint anomaly alert live at the runtime
 * guardrail layer, not here.
 */
export class TurnBudget implements BudgetAccumulator {
  private _spentUsd = 0;
  private _usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };

  constructor(readonly perTurnCapUsd: number) {}

  addUsage(u: Usage, costUsd: number): void {
    this._usage = {
      input: this._usage.input + u.input,
      output: this._usage.output + u.output,
      cacheRead: this._usage.cacheRead + u.cacheRead,
      cacheWrite: this._usage.cacheWrite + u.cacheWrite,
      total: this._usage.total + u.total,
    };
    this._spentUsd += costUsd;
  }

  get spentUsd(): number {
    return this._spentUsd;
  }

  get usage(): Usage {
    return this._usage;
  }

  assertWithinCap(): void {
    if (this.perTurnCapUsd > 0 && this._spentUsd > this.perTurnCapUsd) {
      throw new BudgetExceeded({
        message: `per-turn budget exceeded: $${
          this._spentUsd.toFixed(USD_DECIMAL_PLACES)
        } > $${this.perTurnCapUsd}`,
        scope: "per_turn_usd",
      });
    }
  }
}
