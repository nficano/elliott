import type {
  FacilityBinding,
  JsonRecord,
} from "../../src/runtime/skills/types";

export interface EchoBinding {
  readonly binding: FacilityBinding;
  readonly acquired: {
    consumer: string;
    name: string;
    config: JsonRecord;
  }[];
  readonly released: string[];
}
