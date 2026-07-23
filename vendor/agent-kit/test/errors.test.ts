import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  BudgetExceeded,
  ConfigError,
  isTaggedError,
  ToolError,
} from "../src/core/errors.js";
import { guard } from "../src/core/result.js";

describe("error taxonomy", () => {
  test("BudgetExceeded round-trips through its schema", () => {
    const error = new BudgetExceeded({
      message: "turn budget exhausted",
      scope: "per_turn_usd",
    });

    const encoded = Schema.encodeUnknownSync(BudgetExceeded)(error);
    expect(encoded).toEqual({
      _tag: "BudgetExceeded",
      message: "turn budget exhausted",
      scope: "per_turn_usd",
    });

    const decoded = Schema.decodeUnknownSync(BudgetExceeded)(encoded);
    expect(decoded).toBeInstanceOf(BudgetExceeded);
    expect(decoded.retryable).toBe(false);
  });

  test("guard passes through only public taxonomy errors", async () => {
    const original = new ConfigError({ message: "invalid config" });
    const passedThrough = await Effect.runPromise(
      guard(
        async () => {
          throw original;
        },
        (cause) => new ToolError({ message: "fallback", cause }),
      ).pipe(Effect.flip),
    );
    expect(passedThrough).toBe(original);

    const foreign = Object.assign(new Error("nope"), {
      _tag: "ForeignError",
      retryable: true,
    });
    const normalized = await Effect.runPromise(
      guard(
        async () => {
          throw foreign;
        },
        (cause) => new ToolError({ message: "fallback", cause }),
      ).pipe(Effect.flip),
    );
    expect(normalized).toBeInstanceOf(ToolError);
    expect(normalized).not.toBe(foreign);
  });

  test("tagged-error refinement validates field types", () => {
    expect(
      isTaggedError({ _tag: "Example", message: "failed", retryable: true }),
    ).toBe(true);
    expect(
      isTaggedError({ _tag: "Example", message: "failed", retryable: "yes" }),
    ).toBe(false);
  });
});
