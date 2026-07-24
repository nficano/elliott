import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { makeSlackClients } from "./client";
import { SlackGateway } from "./gateway";
import { slackMessageTool } from "./message";
import { slackSearchTool } from "./search";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.slack;
  if (settings === undefined) return {};
  const clients = makeSlackClients(settings);
  return {
    gateways: [
      new SlackGateway(settings, {
        clients,
        report: (error, mechanism) => context.report(error, mechanism),
      }),
    ],
    tools: [
      slackMessageTool(settings, clients.bot),
      slackSearchTool(clients),
    ],
  };
};
