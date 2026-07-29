import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../src/providers/http";
import { verifiedSignatureHeader } from "../../../src/runtime/skills/http";
import type {
  GatewayEvents,
  RouteBinding,
} from "../../../src/runtime/skills/types";
import { GATEWAY_NAME } from "./constants";
import { decodeInteraction } from "./events";
import type {
  ChoiceAction,
  InteractionHandlerOptions,
  SlackJson,
} from "./types";

// Buttons whose action_id starts with this prefix are "choice" actions: the
// gateway acknowledges the click through the payload's response_url. The
// slack_send_interactive tool mints them; both delivery paths (Socket Mode
// frames and the ingress.webhook interactivity endpoint) handle them.
export const CHOICE_ACTION_PREFIX = "elliott_choice";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const RESPONSE_URL_TIMEOUT_MILLISECONDS = 15_000;

// The consumer half of the ingress.webhook grant: Slack's interactivity POST
// arrives here after the provisioner verified the slack-v2 signature. The
// internal x-elliott-signature hop is verified again so nothing that can
// reach the runtime port can forge "verified" interactions.
export const interactivityRoute = (
  path: string,
  internalSecret: string,
  options: InteractionHandlerOptions,
): RouteBinding => ({
  method: "POST",
  path,
  handle: async (request, events) => {
    const body = await request.text();
    if (!verifiedSignatureHeader(request, body, internalSecret)) {
      return new Response("Invalid signature", { status: HTTP_UNAUTHORIZED });
    }
    const payload = parseInteractionBody(
      body,
      request.headers.get("content-type"),
    );
    if (payload === undefined) {
      return new Response("Invalid payload", { status: HTTP_BAD_REQUEST });
    }
    await handleInteractionPayload(payload, options, events);
    return new Response(undefined, { status: HTTP_OK });
  },
});

// Slack delivers interactivity as form-encoded `payload=<json>`; the JSON
// shape also arrives directly over Socket Mode frames.
export const parseInteractionBody = (
  body: string,
  contentType: string | null,
): SlackJson | undefined => {
  const raw = contentType?.includes("json") === true
    ? body
    : new URLSearchParams(body).get("payload") ?? "";
  try {
    const value: unknown = JSON.parse(raw);
    return isJsonRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

// One decode path for every interaction source. Returns whether the payload
// was recognized and handled.
export const handleInteractionPayload = async (
  payload: SlackJson,
  options: InteractionHandlerOptions,
  events: GatewayEvents,
): Promise<boolean> => {
  const choice = decodeChoice(payload, options.ownerId);
  if (choice !== undefined) {
    await acknowledgeChoice(choice, options);
    return true;
  }
  const action = decodeInteraction(payload, options.ownerId);
  if (action === undefined) return false;
  if (action.type === "delete") {
    await options.client.request("chat.delete", {
      channel: action.channel,
      ts: action.message,
    });
    return true;
  }
  await events.onFeedback({
    gateway: GATEWAY_NAME,
    channel: action.channel,
    message: action.message,
    sender: action.sender,
    sentiment: action.sentiment,
    source: "button",
  });
  return true;
};

const decodeChoice = (
  payload: SlackJson,
  ownerId: string,
): ChoiceAction | undefined => {
  if (payload["type"] !== "block_actions") return undefined;
  if (nestedRecord(payload, "user")?.["id"] !== ownerId) return undefined;
  const action = recordArray(payload, "actions")[0];
  const actionId = action?.["action_id"];
  if (
    typeof actionId !== "string"
    || !actionId.startsWith(CHOICE_ACTION_PREFIX)
  ) return undefined;
  const value = action?.["value"];
  const responseUrl = payload["response_url"];
  if (typeof value !== "string" || typeof responseUrl !== "string") {
    return undefined;
  }
  return { value, responseUrl };
};

const acknowledgeChoice = async (
  choice: ChoiceAction,
  options: InteractionHandlerOptions,
): Promise<void> => {
  const target = new URL(choice.responseUrl);
  // The payload is sender-verified, but response_url still gets pinned to
  // Slack's webhook host so a decode bug can never turn into SSRF.
  if (target.protocol !== "https:" || target.hostname !== "hooks.slack.com") {
    throw new Error(`Interaction response_url is not Slack: ${target.host}`);
  }
  const fetcher = options.fetcher ?? fetch;
  try {
    await fetcher(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        response_type: "in_channel",
        replace_original: false,
        text: `You picked *${choice.value}*`,
      }),
      signal: AbortSignal.timeout(RESPONSE_URL_TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    options.report(error, "slack:interactivity:response_url");
  }
};
