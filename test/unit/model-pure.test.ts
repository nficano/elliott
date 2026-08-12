import { describe, expect, it } from "bun:test";
import { scopeId } from "../../src/core/brands";
import { NoEligibleRouteError } from "../../src/core/errors";
import type { Scope } from "../../src/core/types";
import { evaluateEscalation } from "../../src/model/profile";
import type {
  EscalationRequest,
  ModelUsePolicy,
} from "../../src/model/profile/types";
import { selectBudgetedRoute } from "../../src/model/resolver";
import type {
  DispatchUsage,
  ResolvedModelRoute,
} from "../../src/model/routing/types";
import { makeCatalogEntry, makeResidencyGrant } from "../helpers";

const SCOPE: Scope = { level: "session", id: scopeId("s") };

const policy: ModelUsePolicy = {
  defaultProfile: "balanced",
  uses: {},
  escalationChains: {
    fast: ["balanced", "deep"],
    balanced: ["deep"],
  },
};

const request = (
  overrides: Partial<EscalationRequest>,
): EscalationRequest => ({
  activity: "reasoning",
  from: "fast",
  to: "balanced",
  ceiling: "deep",
  hasDeepGrant: false,
  scope: SCOPE,
  ...overrides,
});

describe("evaluateEscalation", () => {
  it("reports not-configured when the target is off the chain", () => {
    expect(
      evaluateEscalation(policy, request({ from: "balanced", to: "fast" })),
    ).toEqual({
      profile: "balanced",
      escalated: false,
      reason: "not-configured",
    });
  });

  it("reports ceiling when the target exceeds the maximum profile", () => {
    expect(
      evaluateEscalation(
        policy,
        request({ from: "fast", to: "balanced", ceiling: "fast" }),
      ),
    ).toEqual({ profile: "fast", escalated: false, reason: "ceiling" });
  });

  it("reports grant when escalating to deep without a grant", () => {
    expect(
      evaluateEscalation(
        policy,
        request({
          from: "fast",
          to: "deep",
          ceiling: "deep",
          hasDeepGrant: false,
        }),
      ),
    ).toEqual({ profile: "fast", escalated: false, reason: "grant" });
  });

  it("escalates to a non-deep target within ceiling", () => {
    expect(
      evaluateEscalation(
        policy,
        request({ from: "fast", to: "balanced", ceiling: "balanced" }),
      ),
    ).toEqual({ profile: "balanced", escalated: true });
  });

  it("escalates to deep when a deep grant is present", () => {
    expect(
      evaluateEscalation(
        policy,
        request({
          from: "fast",
          to: "deep",
          ceiling: "deep",
          hasDeepGrant: true,
        }),
      ),
    ).toEqual({ profile: "deep", escalated: true });
  });
});

const usage: DispatchUsage = {
  promptInputTokens: 1000,
  maximumOutputTokens: 1000,
  actualOutputTokens: 500,
  cachedInputTokens: 0,
  latencyMs: 10,
};

const makeRoute = (
  provider: string,
  opts: {
    readonly priority?: number;
    readonly costMetric?: number;
    readonly inputRate?: number;
    readonly outputRate?: number;
  } = {},
): ResolvedModelRoute => ({
  provider,
  model: "model",
  priority: opts.priority ?? 1,
  costMetric: opts.costMetric ?? 1,
  catalog: {
    ...makeCatalogEntry(),
    costPerThousandInputTokensUsd: opts.inputRate ?? 0.1,
    costPerThousandOutputTokensUsd: opts.outputRate ?? 0.2,
  },
  residency: makeResidencyGrant(provider),
});

describe("selectBudgetedRoute", () => {
  it("keeps only candidates within the cost budget", () => {
    const cheap = makeRoute("cheap"); // 0.1 + 0.2 = 0.3
    const pricey = makeRoute("pricey", { inputRate: 10, outputRate: 10 }); // 20
    const result = selectBudgetedRoute({
      candidates: [cheap, pricey],
      usage,
      maxCostUsd: 1,
      previousStickyKey: undefined,
    });
    expect(result.budgeted).toEqual([cheap]);
    expect(result.selected).toBe(cheap);
    expect(result.stickyKey).toBe("cheap/model");
  });

  it("keeps all candidates when the budget is undefined", () => {
    const a = makeRoute("a");
    const b = makeRoute("b", { inputRate: 10, outputRate: 10 });
    const result = selectBudgetedRoute({
      candidates: [a, b],
      usage,
      maxCostUsd: undefined,
      previousStickyKey: undefined,
    });
    expect(result.budgeted).toEqual([a, b]);
  });

  it("reuses the previous sticky key when it stays tied to the front-runner", () => {
    const a = makeRoute("a");
    const b = makeRoute("b"); // same priority + costMetric => tied
    const result = selectBudgetedRoute({
      candidates: [a, b],
      usage,
      maxCostUsd: undefined,
      previousStickyKey: "b/model",
    });
    expect(result.selected).toBe(b);
    expect(result.stickyKey).toBe("b/model");
  });

  it("falls back to the front-runner when the previous key is absent", () => {
    const a = makeRoute("a");
    const b = makeRoute("b");
    const result = selectBudgetedRoute({
      candidates: [a, b],
      usage,
      maxCostUsd: undefined,
      previousStickyKey: "gone/model",
    });
    expect(result.selected).toBe(a);
    expect(result.stickyKey).toBe("a/model");
  });

  it("falls back to the front-runner when the previous key is no longer tied", () => {
    const a = makeRoute("a");
    const b = makeRoute("b", { costMetric: 99 }); // present but not tied to a
    const result = selectBudgetedRoute({
      candidates: [a, b],
      usage,
      maxCostUsd: undefined,
      previousStickyKey: "b/model",
    });
    expect(result.selected).toBe(a);
    expect(result.stickyKey).toBe("a/model");
  });

  it("throws with the full candidate list when nothing survives the budget", () => {
    const cheap = makeRoute("cheap");
    const pricey = makeRoute("pricey", { inputRate: 10, outputRate: 10 });
    try {
      selectBudgetedRoute({
        candidates: [cheap, pricey],
        usage,
        maxCostUsd: 0.001,
        previousStickyKey: undefined,
      });
      throw new Error("expected NoEligibleRouteError");
    } catch (error) {
      expect(error).toBeInstanceOf(NoEligibleRouteError);
      const routeError = error as NoEligibleRouteError;
      expect(routeError.emptiedBy).toBe("budget");
      expect(routeError.lastSurvivors).toEqual(["cheap/model", "pricey/model"]);
    }
  });
});
