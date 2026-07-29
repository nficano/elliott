import type {
  RouteBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";

export interface LoadedWebhookFacility {
  readonly context: SkillContext;
  readonly reported: readonly string[];
  readonly provider: SkillRegistration;
  readonly consumer: SkillRegistration;
  readonly verificationRoute: RouteBinding;
  readonly consumerRoute: RouteBinding;
  readonly slug: string;
}

export interface LoadedPublishSkills {
  readonly context: SkillContext;
  readonly reported: readonly string[];
  readonly skills: ReadonlyMap<string, SkillRegistration>;
}

export interface FacilityGrantRow {
  readonly facilityId: string;
  readonly consumer: string;
  readonly grant: {
    readonly values: Readonly<Record<string, unknown>>;
  };
}
