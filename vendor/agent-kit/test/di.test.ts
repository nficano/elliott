import { describe, expect, test } from "bun:test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import type { ServiceGet } from "../src/core/di/services.js";

/**
 * Effect DI (§4, Phase B). The hand-rolled container is retired; process-lifetime
 * dependencies are `Context.Service` services, reached by `ctx.get(Svc)` (a locator
 * over the app `Context`) or, inside Effect programs, by `yield* Svc`.
 */
class Svc extends Context.Service<Svc, { readonly n: number; }>()("test/Svc") {}
class Other
  extends Context.Service<Other, { readonly s: string; }>()("test/Other")
{}

function getFrom<R>(context: Context.Context<R>): ServiceGet {
  return (key) =>
    Context.getOrElse(context, key, () => {
      throw new Error(`missing test service: ${key.key}`);
    });
}

describe("Effect DI (§4) — Context service locator", () => {
  test("get resolves a present service by its Tag", () => {
    const ctx = Context.make(Svc, { n: 42 });
    const get = getFrom(ctx);
    expect(get(Svc).n).toBe(42);
  });

  test("get throws for a service that was not provided (unregistered-token parity)", () => {
    const ctx = Context.make(Svc, { n: 1 });
    const get = getFrom(ctx);
    expect(() => get(Other)).toThrow();
  });

  test("an Effect program reads a service via yield* and provide discharges it", async () => {
    const program = Effect.gen(function*() {
      const svc = yield* Svc;
      return svc.n + 1;
    });
    const out = await Effect.runPromise(
      Effect.provide(program, Context.make(Svc, { n: 10 })),
    );
    expect(out).toBe(11);
  });

  test("a ManagedRuntime builds merged service layers once for repeated runs", async () => {
    let builds = 0;
    const servicesLayer = Layer.mergeAll(
      Layer.sync(Svc)(() => {
        builds += 1;
        return { n: 10 };
      }),
      Layer.succeed(Other)({ s: "ready" }),
    );
    const runtime = ManagedRuntime.make(servicesLayer);

    try {
      const context = await runtime.context();
      const get = getFrom(context);
      expect(get(Other).s).toBe("ready");
      const first = await runtime.runPromise(Effect.map(Svc, (svc) => svc.n));
      const second = await runtime.runPromise(
        Effect.map(Svc, (svc) => svc.n + 1),
      );
      expect(first).toBe(10);
      expect(second).toBe(11);
      expect(builds).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });

  test("serviceOption is None when absent, Some when present (optional services §16)", async () => {
    const absent = await Effect.runPromise(Effect.serviceOption(Other));
    expect(Option.isNone(absent)).toBe(true);

    const present = await Effect.runPromise(
      Effect.provide(
        Effect.serviceOption(Other),
        Context.make(Other, { s: "hi" }),
      ),
    );
    expect(Option.isSome(present)).toBe(true);
  });
});
