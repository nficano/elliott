import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  verifySlackV2,
  WEBHOOK_VERIFIERS,
} from "../../skills/webhook-provisioner/src/profiles";

// Unit coverage for the webhook-provisioner verification profiles — pure
// predicates over (request, body, material). Every negative case must fail
// closed. See docs/skill-facilities.md.

const SECRET = "profile-secret";
const BODY = JSON.stringify({ hello: "world" });

const hex = (secret: string, value: string): string =>
  createHmac("sha256", secret).update(value).digest("hex");

const post = (headers: Record<string, string>, url?: string): Request =>
  new Request(url ?? "http://runtime/w/slug", {
    method: "POST",
    headers,
    body: BODY,
  });

describe("hmac-sha256 profile", () => {
  const verify = WEBHOOK_VERIFIERS["hmac-sha256"];

  it("accepts a correctly signed body", () => {
    const request = post({ "x-elliott-signature": hex(SECRET, BODY) });
    expect(verify({ request, body: BODY, material: SECRET })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const request = post({ "x-elliott-signature": hex(SECRET, BODY) });
    expect(verify({ request, body: `${BODY} `, material: SECRET })).toBe(false);
  });

  it("rejects the wrong secret and a missing header", () => {
    const signed = post({ "x-elliott-signature": hex("other", BODY) });
    expect(verify({ request: signed, body: BODY, material: SECRET }))
      .toBe(false);
    expect(verify({ request: post({}), body: BODY, material: SECRET }))
      .toBe(false);
  });
});

describe("token-query profile", () => {
  const verify = WEBHOOK_VERIFIERS["token-query"];

  it("accepts the minted token in the query string", () => {
    const request = post({}, `http://runtime/w/slug?token=${SECRET}`);
    expect(verify({ request, body: BODY, material: SECRET })).toBe(true);
  });

  it("rejects a wrong or missing token", () => {
    const wrong = post({}, "http://runtime/w/slug?token=nope");
    expect(verify({ request: wrong, body: BODY, material: SECRET }))
      .toBe(false);
    expect(verify({ request: post({}), body: BODY, material: SECRET }))
      .toBe(false);
  });
});

describe("slack-v2 profile", () => {
  const NOW = 1_700_000_000_000;
  const sign = (timestamp: number, body: string, secret = SECRET): string => {
    const base = `v0:${timestamp}:${body}`;
    return `v0=${hex(secret, base)}`;
  };
  const slackRequest = (timestamp: number, signature: string): Request =>
    post({
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
    });

  it("accepts a fresh, correctly signed request", () => {
    const timestamp = NOW / 1000;
    const request = slackRequest(timestamp, sign(timestamp, BODY));
    expect(verifySlackV2({ request, body: BODY, material: SECRET }, NOW))
      .toBe(true);
  });

  it("tolerates small clock skew in both directions", () => {
    for (const skew of [-299, 299]) {
      const timestamp = NOW / 1000 + skew;
      const request = slackRequest(timestamp, sign(timestamp, BODY));
      expect(verifySlackV2({ request, body: BODY, material: SECRET }, NOW))
        .toBe(true);
    }
  });

  it("rejects a replayed (stale) timestamp even with a valid signature", () => {
    const timestamp = NOW / 1000 - 301;
    const request = slackRequest(timestamp, sign(timestamp, BODY));
    expect(verifySlackV2({ request, body: BODY, material: SECRET }, NOW))
      .toBe(false);
  });

  it("rejects tampered bodies, wrong secrets, and malformed headers", () => {
    const timestamp = NOW / 1000;
    const good = sign(timestamp, BODY);
    expect(verifySlackV2({
      request: slackRequest(timestamp, good),
      body: `${BODY}x`,
      material: SECRET,
    }, NOW)).toBe(false);
    expect(verifySlackV2({
      request: slackRequest(timestamp, sign(timestamp, BODY, "other")),
      body: BODY,
      material: SECRET,
    }, NOW)).toBe(false);
    expect(verifySlackV2({
      request: post({ "x-slack-signature": good }),
      body: BODY,
      material: SECRET,
    }, NOW)).toBe(false);
    expect(verifySlackV2({
      request: post({ "x-slack-request-timestamp": String(timestamp) }),
      body: BODY,
      material: SECRET,
    }, NOW)).toBe(false);
    expect(verifySlackV2({
      request: slackRequest(timestamp, good),
      body: BODY,
      material: SECRET,
    }, NOW + 301_000)).toBe(false);
    const fractional = slackRequest(0.5, sign(0.5, BODY));
    expect(
      verifySlackV2({ request: fractional, body: BODY, material: SECRET }, NOW),
    )
      .toBe(false);
  });
});
