import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import {
  narrowProfileCeiling,
  profileWithinCeiling,
  validateProfileCompleteness,
  validateProfileId,
} from "../../src/model/profile";

describe("G8 model profile completeness", () => {
  it("requires every reserved profile to be bound or explicitly unavailable", () => {
    expect(() =>
      validateProfileCompleteness({
        profiles: {
          fast: { routes: [], unavailable: true, digest: digest("fast") },
          balanced: {
            routes: [],
            unavailable: true,
            digest: digest("balanced"),
          },
        },
      })
    ).toThrow("deep");
    expect(() =>
      validateProfileCompleteness({
        profiles: {
          fast: { routes: [], unavailable: true, digest: digest("fast") },
          balanced: {
            routes: [],
            unavailable: true,
            digest: digest("balanced"),
          },
          deep: { routes: [], unavailable: true, digest: digest("deep") },
        },
      })
    ).not.toThrow();
  });

  it("uses capability-only ceilings and rejects reserved-looking typos", () => {
    expect(profileWithinCeiling("deep", "balanced")).toBe(false);
    expect(profileWithinCeiling("fast", "balanced")).toBe(true);
    expect(narrowProfileCeiling("balanced", "deep")).toBe("balanced");
    expect(() => validateProfileId("balnced")).toThrow("custom:");
  });
});
