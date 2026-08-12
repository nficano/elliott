import { describe, expect, it } from "bun:test";
import { principalId } from "../../src/core/brands";
import { isSecretAuthorized } from "../../src/security/secrets/secrets";
import type {
  SecretAuthorizationQuery,
  SecretRegistration,
} from "../../src/security/secrets/types";

const NOW_MS = 1_000_000;
const FUTURE_MS = 2_000_000;
const PAST_MS = 500_000;

const registration = (
  overrides: Partial<SecretRegistration["policy"]> = {},
): SecretRegistration => ({
  uri: "secret://vault/token",
  value: "s3cr3t",
  policy: {
    principal: principalId("agent"),
    destination: "https://api.example.com",
    operation: "request",
    expiresAt: new Date(FUTURE_MS).toISOString(),
    rotation: "P30D",
    injection: "broker-request",
    ...overrides,
  },
});

const query = (
  overrides: Partial<SecretAuthorizationQuery> = {},
): SecretAuthorizationQuery => ({
  uri: "secret://vault/token",
  principal: principalId("agent"),
  destination: "https://api.example.com",
  operation: "request",
  injection: "broker-request",
  ...overrides,
});

describe("isSecretAuthorized", () => {
  it("denies when the registration is undefined", () => {
    expect(isSecretAuthorized(undefined, query(), NOW_MS)).toBe(false);
  });

  it("denies on each mismatched access-control dimension", () => {
    const cases: readonly SecretAuthorizationQuery[] = [
      query({ principal: principalId("other") }),
      query({ destination: "https://evil.example.com" }),
      query({ operation: "mount" }),
      query({ injection: "runtime-mount" }),
    ];
    for (const mismatched of cases) {
      expect(isSecretAuthorized(registration(), mismatched, NOW_MS)).toBe(
        false,
      );
    }
  });

  it("denies when the policy has expired at the boundary", () => {
    const expired = registration({
      expiresAt: new Date(NOW_MS).toISOString(),
    });
    expect(isSecretAuthorized(expired, query(), NOW_MS)).toBe(false);
  });

  it("denies when the policy expired in the past", () => {
    const expired = registration({
      expiresAt: new Date(PAST_MS).toISOString(),
    });
    expect(isSecretAuthorized(expired, query(), NOW_MS)).toBe(false);
  });

  it("allows when every dimension matches and the policy is live", () => {
    expect(isSecretAuthorized(registration(), query(), NOW_MS)).toBe(true);
  });

  it("allows one millisecond before expiry", () => {
    const live = registration({
      expiresAt: new Date(NOW_MS + 1).toISOString(),
    });
    expect(isSecretAuthorized(live, query(), NOW_MS)).toBe(true);
  });
});
