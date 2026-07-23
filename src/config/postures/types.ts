import type { DataClassification } from "../../core/types";

export type Posture = "standard" | "hardened" | "regulated";

export interface PostureSpec {
  readonly posture: Posture;
  readonly lattice: readonly DataClassification[];
  readonly residencyFiltering: boolean;
  readonly sanitizerEnabled: boolean;
  readonly trustedLocalEvaluatorRequired: boolean;
}

export interface ClassificationStamp {
  readonly classification: DataClassification;
  readonly writtenUnder: Posture;
}

export interface TaxonomyMigration {
  readonly from: Posture;
  readonly to: Posture;
  readonly mapping: Readonly<
    Partial<Record<DataClassification, DataClassification>>
  >;
}
