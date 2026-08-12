import { describe, expect, it } from "bun:test";
import { LifecycleTransitionError } from "../../src/core/errors";
import { assertTransition } from "../../src/core/instance/instance";
import type { LifecycleState } from "../../src/core/types";

const LEGAL: readonly (readonly [LifecycleState, LifecycleState])[] = [
  ["created", "opening"],
  ["created", "failed"],
  ["opening", "open"],
  ["opening", "failed"],
  ["open", "draining"],
  ["open", "failed"],
  ["draining", "closed"],
  ["draining", "failed"],
];

const ILLEGAL: readonly (readonly [LifecycleState, LifecycleState])[] = [
  ["created", "open"],
  ["created", "draining"],
  ["created", "closed"],
  ["opening", "opening"],
  ["opening", "draining"],
  ["opening", "closed"],
  ["open", "open"],
  ["open", "opening"],
  ["open", "closed"],
  ["draining", "open"],
  ["draining", "opening"],
  ["draining", "draining"],
  ["closed", "failed"],
  ["closed", "opening"],
  ["closed", "closed"],
  ["failed", "failed"],
  ["failed", "opening"],
  ["failed", "open"],
];

describe("assertTransition lifecycle matrix", () => {
  it("permits every legal lifecycle edge", () => {
    for (const [from, to] of LEGAL) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("rejects illegal edges with a typed error carrying the offending from/to", () => {
    for (const [from, to] of ILLEGAL) {
      let caught: unknown;
      try {
        assertTransition(from, to);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LifecycleTransitionError);
      expect((caught as LifecycleTransitionError).from).toBe(from);
      expect((caught as LifecycleTransitionError).to).toBe(to);
    }
  });
});
