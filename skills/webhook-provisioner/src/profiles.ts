import {
  constantTimeEqual,
  hmacSha256Hex,
  SIGNATURE_HEADER,
  verifiedRequestToken,
} from "../../../src/runtime/skills/http";
import type {
  VerificationInput,
  WebhookProfileId,
  WebhookVerifier,
} from "./types";

const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";
const SLACK_SIGNATURE_HEADER = "x-slack-signature";
const SLACK_TOLERANCE_SECONDS = 300;
const MILLISECONDS_PER_SECOND = 1000;

// Each profile is a small pure predicate over (request, body, material). All
// signature comparisons are constant-time. Facility-minted profiles
// (hmac-sha256, token-query) verify against material the grant returned to
// the consumer; sender-defined profiles (slack-v2) verify against the
// sender's own secret resolved from settings.
export const WEBHOOK_VERIFIERS: Readonly<
  Record<WebhookProfileId, WebhookVerifier>
> = {
  "hmac-sha256": ({ request, body, material }) => {
    const provided = request.headers.get(SIGNATURE_HEADER);
    return provided !== null && provided.length > 0
      && constantTimeEqual(provided, hmacSha256Hex(material, body));
  },
  "token-query": ({ request, material }) =>
    verifiedRequestToken(request, material),
  "slack-v2": (input) => verifySlackV2(input, Date.now()),
};

// Slack's v2 request signing: v0=HMAC(secret, "v0:{timestamp}:{body}") with a
// five-minute timestamp tolerance against replay of captured requests.
export const verifySlackV2 = (
  input: VerificationInput,
  nowMilliseconds: number,
): boolean => {
  const timestamp = input.request.headers.get(SLACK_TIMESTAMP_HEADER);
  const provided = input.request.headers.get(SLACK_SIGNATURE_HEADER);
  if (timestamp === null || provided === null || provided.length === 0) {
    return false;
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  const age = Math.abs(nowMilliseconds / MILLISECONDS_PER_SECOND - seconds);
  if (age > SLACK_TOLERANCE_SECONDS) return false;
  const expected = `v0=${
    hmacSha256Hex(input.material, `v0:${timestamp}:${input.body}`)
  }`;
  return constantTimeEqual(provided, expected);
};
