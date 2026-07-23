import { describe, expect, test } from "bun:test";
import {
  hasDeferred,
  interpolateSpecTree,
  isDeferredExpr,
  resolveDeferredTree,
  SpecInterpolationError,
} from "../src/host/spec/interpolate.js";

const ctx = (over: Partial<{
  secrets: Record<string, string>;
  config: Record<string, unknown>;
}> = {}) => ({
  file: "agents/test.yaml",
  secrets: { brave: "sk-brave", oauth: "sk-oauth", ...over.secrets },
  config: {
    channels: ["a", "b"],
    window: { start: "06:00" },
    limit: 5,
    greeting: "hi",
    ...over.config,
  },
});

describe("phase 1 — load-time contexts (secrets.*, config.*)", () => {
  test("whole-value expression preserves the resolved type", () => {
    expect(interpolateSpecTree("${{ config.channels }}", ctx())).toEqual([
      "a",
      "b",
    ]);
    expect(interpolateSpecTree("${{ config.window }}", ctx())).toEqual({
      start: "06:00",
    });
    expect(interpolateSpecTree("${{ config.limit }}", ctx())).toBe(5);
    expect(interpolateSpecTree("${{ secrets.brave }}", ctx())).toBe("sk-brave");
  });

  test("embedded expressions stringify", () => {
    expect(interpolateSpecTree("key=${{ secrets.brave }}!", ctx())).toBe(
      "key=sk-brave!",
    );
    expect(interpolateSpecTree("n=${{ config.limit }}", ctx())).toBe("n=5");
    expect(interpolateSpecTree("list=${{ config.channels }}", ctx())).toBe(
      'list=["a","b"]',
    );
  });

  test("binary + at load time: arrays, strings, numbers", () => {
    expect(
      interpolateSpecTree("${{ config.channels + config.channels }}", ctx()),
    ).toEqual(["a", "b", "a", "b"]);
    expect(
      interpolateSpecTree("${{ config.limit + config.limit }}", ctx()),
    ).toBe(10);
    expect(
      interpolateSpecTree("${{ config.greeting + secrets.brave }}", ctx()),
    ).toBe("hisk-brave");
  });

  test("string + number coerces to string concat", () => {
    expect(
      interpolateSpecTree("${{ config.greeting + config.limit }}", ctx()),
    ).toBe("hi5");
  });

  test("walks nested objects and arrays; non-strings untouched", () => {
    const tree = {
      with: {
        channels: "${{ config.channels }}",
        deep: [{ v: "${{ config.limit }}" }, 7, true, null],
      },
    };
    expect(interpolateSpecTree(tree, ctx())).toEqual({
      with: { channels: ["a", "b"], deep: [{ v: 5 }, 7, true, null] },
    });
  });

  test("strings without ${{ }} pass through (incl. ${ENV} placeholders)", () => {
    expect(interpolateSpecTree("plain", ctx())).toBe("plain");
    expect(interpolateSpecTree("${ENV:NOT_OURS}", ctx())).toBe(
      "${ENV:NOT_OURS}",
    );
  });

  test("unknown secret is a load error naming file and expression", () => {
    let caught: unknown;
    try {
      interpolateSpecTree("${{ secrets.missing }}", ctx());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpecInterpolationError);
    const message = (caught as Error).message;
    expect(message).toContain("agents/test.yaml");
    expect(message).toContain("missing");
    expect(message).toContain("${{ secrets.missing }}");
  });

  test("unknown config path is a load error naming file and expression", () => {
    expect(() => interpolateSpecTree("${{ config.nope.x }}", ctx())).toThrow(
      SpecInterpolationError,
    );
    expect(() => interpolateSpecTree("${{ config.nope.x }}", ctx())).toThrow(
      /agents\/test\.yaml.*config\.nope\.x/,
    );
  });

  test("unknown context and malformed operands are load errors", () => {
    expect(() => interpolateSpecTree("${{ env.HOME }}", ctx())).toThrow(
      /unknown context "env"/,
    );
    expect(() => interpolateSpecTree("${{ config.a + }}", ctx())).toThrow(
      SpecInterpolationError,
    );
    expect(() => interpolateSpecTree("${{ !!! }}", ctx())).toThrow(
      SpecInterpolationError,
    );
  });
});

describe("phase 2 — steps.* defers to runtime", () => {
  test("a steps expression survives load as a DeferredExpr node", () => {
    const value = interpolateSpecTree("${{ steps.uploads.outputs.videos }}", ctx());
    expect(isDeferredExpr(value)).toBe(true);
    expect(hasDeferred({ nested: [value] })).toBe(true);
    expect(hasDeferred({ nested: ["plain"] })).toBe(false);
  });

  test("whole-value runtime resolution preserves type", () => {
    const node = interpolateSpecTree("${{ steps.uploads.outputs.videos }}", ctx());
    const resolved = resolveDeferredTree(node, {
      steps: { uploads: { videos: [1, 2] } },
    });
    expect(resolved).toEqual([1, 2]);
  });

  test("+ concat of two step outputs (the oslo playlist case)", () => {
    const node = interpolateSpecTree(
      "${{ steps.uploads.outputs.videos + steps.pakman.outputs.videos }}",
      ctx(),
    );
    const resolved = resolveDeferredTree(node, {
      steps: {
        uploads: { videos: ["u1", "u2"] },
        pakman: { videos: ["p1"] },
      },
    });
    expect(resolved).toEqual(["u1", "u2", "p1"]);
  });

  test("mixed load-time + runtime operands pre-resolve the load half", () => {
    const node = interpolateSpecTree(
      "${{ config.channels + steps.extra.outputs.items }}",
      ctx(),
    );
    expect(isDeferredExpr(node)).toBe(true);
    expect(
      resolveDeferredTree(node, { steps: { extra: { items: ["z"] } } }),
    ).toEqual(["a", "b", "z"]);
  });

  test("embedded runtime expression stringifies", () => {
    const node = interpolateSpecTree(
      "body: ${{ steps.turn.outputs.text }}",
      ctx(),
    );
    expect(
      resolveDeferredTree(node, { steps: { turn: { text: "hello" } } }),
    ).toBe("body: hello");
  });

  test("steps.<id>.outputs with no further path yields the whole output", () => {
    const node = interpolateSpecTree("${{ steps.digest.outputs }}", ctx());
    expect(
      resolveDeferredTree(node, { steps: { digest: { n: 1 } } }),
    ).toEqual({ n: 1 });
  });

  test("resolution walks nested trees and leaves plain values alone", () => {
    const tree = interpolateSpecTree(
      { body: "${{ steps.a.outputs.x }}", keep: 42 },
      ctx(),
    );
    expect(
      resolveDeferredTree(tree, { steps: { a: { x: "v" } } }),
    ).toEqual({ body: "v", keep: 42 });
  });

  test("unknown step at runtime errors naming the expression and known steps", () => {
    const node = interpolateSpecTree("${{ steps.ghost.outputs }}", ctx());
    let caught: unknown;
    try {
      resolveDeferredTree(node, { steps: { real: {} } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpecInterpolationError);
    expect((caught as Error).message).toContain("steps.ghost.outputs");
    expect((caught as Error).message).toContain("real");
  });

  test("runtime paths must be steps.<id>.outputs…", () => {
    const node = interpolateSpecTree("${{ steps.a.result }}", ctx());
    expect(() => resolveDeferredTree(node, { steps: { a: {} } })).toThrow(
      /steps\.<id>\.outputs/,
    );
  });

  test("number add across two step outputs", () => {
    const node = interpolateSpecTree(
      "${{ steps.a.outputs.n + steps.b.outputs.n }}",
      ctx(),
    );
    expect(
      resolveDeferredTree(node, { steps: { a: { n: 2 }, b: { n: 3 } } }),
    ).toBe(5);
  });

  test("+ on incompatible types is an error naming the expression", () => {
    const node = interpolateSpecTree(
      "${{ steps.a.outputs.obj + steps.b.outputs.arr }}",
      ctx(),
    );
    expect(() =>
      resolveDeferredTree(node, {
        steps: { a: { obj: { x: 1 } }, b: { arr: [1] } },
      })
    ).toThrow(/cannot apply \+/);
  });
});
