import { newId } from "../../core/digest";
import {
  type LearningSignal,
  type LearningSignalRank,
  SELF_REFLECTION_RANK,
} from "../types";

export class SignalDetector {
  readonly #signals: LearningSignal[] = [];

  record(
    rank: LearningSignalRank,
    source: string,
    evidence: string,
  ): LearningSignal {
    const signal: LearningSignal = Object.freeze({
      id: newId("signal"),
      rank,
      source,
      evidence,
      createdAt: new Date().toISOString(),
    });
    this.#signals.push(signal);
    return signal;
  }

  ranked(): readonly LearningSignal[] {
    return [...this.#signals].sort((left, right) => left.rank - right.rank);
  }
}

export const signalsPermitPromotion = (
  signals: readonly LearningSignal[],
): boolean => signals.some((signal) => signal.rank < SELF_REFLECTION_RANK);
