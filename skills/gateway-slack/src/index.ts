import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { SlackGateway } from "./gateway";
import { slackMessageTool } from "./message";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.slack;
  return settings === undefined ? {} : {
    gateways: [new SlackGateway(settings)],
    tools: [slackMessageTool(settings)],
  };
};
