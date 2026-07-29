import {
  hmacSha256Hex,
  SIGNATURE_HEADER,
} from "../../../src/runtime/skills/http";
import type { RouteBinding } from "../../../src/runtime/skills/types";
import { WEBHOOK_VERIFIERS } from "./profiles";
import type { EndpointRecord, VerificationRouteInput } from "./types";

const HTTP_UNAUTHORIZED = 401;
const HTTP_GONE = 410;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const FORWARD_TIMEOUT_MILLISECONDS = 30_000;

export const endpointPath = (slug: string): string => `/w/${slug}`;

export const internalPath = (slug: string): string => `/v1/ingress/${slug}`;

// The phase-1 in-process stand-in for the isolated ingress proxy: caps and
// verifies the hostile payload, then forwards it to the consumer's route over
// the loopback with the internal x-elliott-signature hop, so the consumer
// sees exactly the delivery contract the phase-3 proxy will honor.
export const verificationRoute = (
  input: VerificationRouteInput,
): RouteBinding => ({
  method: "POST",
  path: endpointPath(input.record.slug),
  handle: async (request) => {
    const { record } = input;
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > record.maxBodyBytes) {
      return new Response("Payload too large", {
        status: HTTP_PAYLOAD_TOO_LARGE,
      });
    }
    if (expired(record)) {
      return new Response("Endpoint expired", { status: HTTP_GONE });
    }
    const material = input.material(record);
    if (material === undefined) {
      input.report(
        new Error(`Endpoint ${record.slug} has no verification material`),
        "webhook-provisioner:material",
      );
      return new Response("Endpoint unavailable", {
        status: HTTP_SERVICE_UNAVAILABLE,
      });
    }
    if (!WEBHOOK_VERIFIERS[record.profile]({ request, body, material })) {
      input.counters.dropped += 1;
      input.report(
        new Error(`Dropped unverifiable ${record.profile} payload`),
        "webhook-provisioner:verify",
      );
      return new Response("Invalid signature", { status: HTTP_UNAUTHORIZED });
    }
    input.counters.verified += 1;
    return forward(input, request, body);
  },
});

const forward = async (
  input: VerificationRouteInput,
  request: Request,
  body: string,
): Promise<Response> => {
  const target = new URL(
    internalPath(input.record.slug),
    `http://127.0.0.1:${input.port}`,
  );
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type")
          ?? "application/octet-stream",
        [SIGNATURE_HEADER]: hmacSha256Hex(input.internalSecret, body),
        "x-elliott-ingress-slug": input.record.slug,
        "x-elliott-ingress-profile": input.record.profile,
        "x-elliott-ingress-timestamp": new Date().toISOString(),
      },
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MILLISECONDS),
    });
    return new Response(await response.text(), { status: response.status });
  } catch (error) {
    input.report(error, "webhook-provisioner:forward");
    return new Response("Delivery failed", { status: HTTP_BAD_GATEWAY });
  }
};

const expired = (record: EndpointRecord): boolean =>
  record.expiresAt !== undefined && Date.parse(record.expiresAt) <= Date.now();
