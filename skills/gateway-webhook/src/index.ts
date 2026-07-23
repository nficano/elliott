import { createHmac, timingSafeEqual } from "node:crypto";
import { isJsonRecord } from "../../../src/providers/http";
import type {
  GatewayEvents,
  RouteBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";

const GATEWAY_NAME = "gateway-webhook";
const SIGNATURE_HEADER = "x-elliott-signature";
const MAX_BODY_BYTES = 65_536;
const HTTP_ACCEPTED = 202;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;

export const register = (context: SkillContext): SkillRegistration => {
  const secret = context.settings.webhookSecret;
  return secret === undefined
    ? {}
    : { routes: [inboundRoute(secret, context)] };
};

const inboundRoute = (secret: string, context: SkillContext): RouteBinding => ({
  method: "POST",
  path: "/v1/gateways/webhook",
  handle: async (request, events) => {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return new Response("Payload too large", {
        status: HTTP_PAYLOAD_TOO_LARGE,
      });
    }
    if (!verifySignature(secret, request, body)) {
      context.report(
        new Error("Webhook payload failed signature verification"),
        "webhook:ingress",
      );
      return new Response("Invalid signature", { status: HTTP_UNAUTHORIZED });
    }
    return dispatch(body, events);
  },
});

const dispatch = async (
  body: string,
  events: GatewayEvents,
): Promise<Response> => {
  const payload = parsePayload(body);
  if (payload === undefined) {
    return new Response("Invalid payload", { status: HTTP_BAD_REQUEST });
  }
  void events.onMessage(payload).catch(events.onError);
  return Response.json({ accepted: true }, { status: HTTP_ACCEPTED });
};

const parsePayload = (body: string) => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isJsonRecord(value)) return undefined;
  const sender = value["sender"];
  const text = value["text"];
  if (typeof sender !== "string" || typeof text !== "string") {
    return undefined;
  }
  if (sender.length === 0 || text.length === 0) return undefined;
  const channel = value["channel"];
  return {
    id: `webhook:${crypto.randomUUID()}`,
    gateway: GATEWAY_NAME,
    channel: typeof channel === "string" ? channel : "",
    sender,
    text,
  };
};

const verifySignature = (
  secret: string,
  request: Request,
  body: string,
): boolean => {
  const provided = request.headers.get(SIGNATURE_HEADER);
  if (provided === null || provided.length === 0) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
};
