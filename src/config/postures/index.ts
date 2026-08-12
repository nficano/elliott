import type { DataClassification } from "../../core/types";
import type {
  ClassificationStamp,
  Posture,
  PostureSpec,
  TaxonomyMigration,
} from "./types";

const specs: Readonly<Record<Posture, PostureSpec>> = {
  standard: {
    posture: "standard",
    lattice: ["internal"],
    residencyFiltering: false,
    sanitizerEnabled: false,
    trustedLocalEvaluatorRequired: false,
  },
  hardened: {
    posture: "hardened",
    lattice: ["public", "internal", "confidential"],
    residencyFiltering: true,
    sanitizerEnabled: true,
    trustedLocalEvaluatorRequired: false,
  },
  regulated: {
    posture: "regulated",
    lattice: ["public", "internal", "confidential", "restricted"],
    residencyFiltering: true,
    sanitizerEnabled: true,
    trustedLocalEvaluatorRequired: true,
  },
};

export const postureSpec = (posture: Posture): PostureSpec => specs[posture];

export class PostureController {
  #posture: Posture;

  constructor(initial: Posture = "standard") {
    this.#posture = initial;
  }

  get current(): PostureSpec {
    return specs[this.#posture];
  }

  stamp(classification: DataClassification): ClassificationStamp {
    return Object.freeze({
      classification: this.#posture === "standard"
        ? "internal"
        : classification,
      writtenUnder: this.#posture,
    });
  }

  activate(migration: TaxonomyMigration): void {
    if (migration.from !== this.#posture) {
      throw new Error("Posture migration source is not active");
    }
    const mapped: readonly DataClassification[] = Object.values(
      migration.mapping,
    );
    if (new Set(mapped).size !== mapped.length) {
      throw new Error("Posture upgrade mapping must be injective");
    }
    this.#posture = migration.to;
  }

  enforceStamp(stamp: ClassificationStamp): DataClassification {
    return stamp.classification;
  }
}

export type * from "./types";
