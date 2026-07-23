import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { SlackGateway } from "./gateway";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.slack;
  return settings === undefined
    ? {}
    : { gateways: [new SlackGateway(settings)] };
};
