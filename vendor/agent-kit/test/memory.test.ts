import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { LlmError } from "../src/core/errors.js";
import type { LlmPort } from "../src/core/llm/types.js";
import { PgMemory } from "../src/core/memory/memory.js";
import type { StorePort } from "../src/store/types.js";

describe("PgMemory best-effort degradation", () => {
  test("embedding failures degrade recall and remember without querying SQL", async () => {
    const store: StorePort = {
      get sql(): StorePort["sql"] {
        throw new Error("unexpected SQL access");
      },
      run: (effect) => Effect.runPromise(effect),
      reserve: async () => {
        throw new Error("unexpected connection reservation");
      },
      now: () => Effect.succeed(new Date(0)),
      health: async () => ({ state: "ok" }),
    };
    const failure = new LlmError({
      message: "embedding unavailable",
      kind: "network",
    });
    const llm: LlmPort = {
      streamTurn: () => Effect.die(new Error("unexpected stream call")),
      complete: () => Effect.die(new Error("unexpected completion call")),
      embed: () => Effect.fail(failure),
    };
    const memory = new PgMemory(store, llm, {
      embedModel: "test-embed",
      dim: 3,
      defaultK: 5,
      threshold: 0.3,
      dedupeCosine: 0.95,
      previewMax: 200,
    });

    const records = await Effect.runPromise(
      memory.prefetch("remember this durable preference", ["owner"]),
    );
    const written = await Effect.runPromise(
      memory.remember([{
        collection: "semantic",
        text: "The owner prefers concise technical status reports.",
        origin: "owner",
      }]),
    );

    expect(records).toEqual([]);
    expect(written).toBe(0);
  });
});
