import type { EvolutionConfig } from "../config";
import type {
  EvolutionClassificationSchema,
  EvolutionRiskClassSchema,
} from "../model/index";

export interface EvolutionPolicyInput {
  readonly config: EvolutionConfig;
  readonly targetRef: string;
  readonly riskClass: typeof EvolutionRiskClassSchema.Type;
  readonly classification: typeof EvolutionClassificationSchema.Type;
  readonly engineRef: string;
  readonly engineIsolation:
    | "declarative"
    | "in-process"
    | "process"
    | "container"
    | "remote";
  readonly engineLocal: boolean;
  readonly continuous: boolean;
}
