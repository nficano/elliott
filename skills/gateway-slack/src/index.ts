import type {
  RouteBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { SlackSettings } from "../../../src/runtime/types";
import { makeSlackClients } from "./client";
import { SlackGateway } from "./gateway";
import { slackInteractiveTool } from "./interactive-demo";
import { interactivityRoute } from "./interactivity";
import { slackMessageTool } from "./message";
import { slackSearchTool } from "./search";
import type { SlackClientSet } from "./types";

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
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
      slackInteractiveTool(settings, clients.bot),
    ],
    routes: await interactivityRoutes(context, settings, clients),
  };
};

// HTTP interactivity through the ingress.webhook facility: the grant's public
// URL is what the Slack app's Interactivity Request URL should point at (used
// when Socket Mode is off), and the internal path is served here. Acquisition
// failures are reported, not fatal — Socket Mode keeps handling interactions.
const interactivityRoutes = async (
  context: SkillContext,
  settings: SlackSettings,
  clients: SlackClientSet,
): Promise<readonly RouteBinding[]> => {
  const internalSecret = context.settings.webhookSecret;
  if (settings.signingSecret === undefined || internalSecret === undefined) {
    return [];
  }
  try {
    const grant = await context.facilities.acquire(
      "ingress.webhook",
      "slack-interactivity",
      {
        verification: { profile: "slack-v2", secretRef: "slack.signingSecret" },
      },
    );
    const internalPath = grant.values["internalPath"];
    if (typeof internalPath !== "string") {
      throw new TypeError("ingress.webhook grant carries no internalPath");
    }
    return [
      interactivityRoute(internalPath, internalSecret, {
        ownerId: settings.ownerId,
        client: clients.bot,
        report: (error, mechanism) => context.report(error, mechanism),
      }),
    ];
  } catch (error) {
    context.report(error, "gateway-slack:interactivity");
    return [];
  }
};
