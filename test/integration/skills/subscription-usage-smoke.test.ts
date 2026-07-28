import { afterEach, describe, expect, it, mock } from "bun:test";
import type { SkillContext } from "../../../src/runtime/skills/types";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for subscription-usage. Fetch is stubbed with a
// cassette so these run offline while driving the real credential parsing,
// token refresh + rotation persistence, and response parsing for each
// provider. See docs/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

const claudeUsageBody = JSON.stringify({
  five_hour: { utilization: 12, resets_at: "2026-07-27T18:00:00.000Z" },
  seven_day: { utilization: 40, resets_at: "2026-08-01T00:00:00.000Z" },
  limits: [{
    kind: "weekly_scoped",
    group: "weekly",
    percent: 3.5,
    resets_at: "2026-08-01T00:00:00.000Z",
    is_active: true,
    scope: { model: { id: "claude-opus-4-8", display_name: "Opus" } },
  }],
});

const codexUsageBody = JSON.stringify({
  plan_type: "plus",
  rate_limit: {
    primary_window: {
      used_percent: 38.5,
      limit_window_seconds: 18_000,
      reset_at: 1_753_600_000,
    },
    secondary_window: {
      used_percent: 12,
      limit_window_seconds: 604_800,
      reset_at: 1_754_000_000,
    },
  },
});

const litellmActivityBody = JSON.stringify({
  results: [{
    date: "2026-07-26",
    metrics: { spend: 1.25, api_requests: 10, total_tokens: 1500 },
    breakdown: {
      models: {
        "anthropic/claude-sonnet-5": { metrics: { spend: 1 } },
        "tier-local": { metrics: { spend: 0.25 } },
      },
    },
  }, {
    date: "2026-07-27",
    metrics: { spend: 0.5, api_requests: 4, total_tokens: 600 },
    breakdown: {
      models: { "anthropic/claude-sonnet-5": { metrics: { spend: 0.5 } } },
    },
  }],
  metadata: { total_spend: 1.75, total_api_requests: 14, total_tokens: 2100 },
});

describe("subscription-usage skill logic (Tier 1)", () => {
  it("reports Claude and Codex windows across accounts", async () => {
    stubFetch([
      { match: "api.anthropic.com/api/oauth/usage", body: claudeUsageBody },
      { match: "chatgpt.com/backend-api/wham/usage", body: codexUsageBody },
    ]);
    const { context } = await makeSmokeContext();
    const usage = toolByName(
      await loadOneSkill("subscription-usage", context),
      "subscription_usage",
    );

    const results = JSON.parse(await usage.execute({}));
    expect(results).toEqual([
      {
        provider: "claude",
        account: "personal",
        windows: [
          {
            window: "5h",
            usedPercent: 12,
            resetsAt: "2026-07-27T18:00:00.000Z",
          },
          {
            window: "7d",
            usedPercent: 40,
            resetsAt: "2026-08-01T00:00:00.000Z",
          },
          {
            window: "weekly (Opus)",
            usedPercent: 3.5,
            resetsAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
      {
        provider: "codex",
        account: "personal",
        plan: "plus",
        windows: [
          {
            window: "5h",
            usedPercent: 38.5,
            resetsAt: new Date(1_753_600_000 * 1000).toISOString(),
          },
          {
            window: "7d",
            usedPercent: 12,
            resetsAt: new Date(1_754_000_000 * 1000).toISOString(),
          },
        ],
      },
    ]);
  });

  it("refreshes an expired Claude token once and persists the rotation", async () => {
    const stub = stubFetch([
      {
        match: "platform.claude.com/v1/oauth/token",
        body: JSON.stringify({
          access_token: "at-claude-2",
          refresh_token: "rt-claude-2",
          expires_in: 28_800,
        }),
      },
      { match: "api.anthropic.com/api/oauth/usage", body: claudeUsageBody },
    ]);
    const { context } = await makeSmokeContext();
    const expired = expiredClaudeContext(context);
    const usage = toolByName(
      await loadOneSkill("subscription-usage", expired),
      "subscription_usage",
    );

    const first = JSON.parse(await usage.execute({ provider: "claude" }));
    expect(first[0].error).toBeUndefined();
    expect(first[0].windows.length).toBeGreaterThan(0);
    const refreshCalls = () =>
      stub.calls.filter((url) => url.includes("platform.claude.com")).length;
    expect(refreshCalls()).toBe(1);

    // The rotated token (fresh expiry) is persisted: no second refresh.
    await usage.execute({ provider: "claude" });
    expect(refreshCalls()).toBe(1);
  });

  it("degrades a failing account to an inline error", async () => {
    stubFetch([
      { match: "api.anthropic.com/api/oauth/usage", body: claudeUsageBody },
      {
        match: "chatgpt.com/backend-api/wham/usage",
        status: 500,
        body: "{}",
      },
    ]);
    const { context } = await makeSmokeContext();
    const usage = toolByName(
      await loadOneSkill("subscription-usage", context),
      "subscription_usage",
    );

    const results = JSON.parse(await usage.execute({}));
    expect(results[0].error).toBeUndefined();
    expect(results[1].error).toMatch(/HTTP 500/);
    await expect(usage.execute({ account: "nope" })).rejects
      .toThrow(/No configured subscription account/);
  });

  it("summarizes LiteLLM daily activity with a model breakdown", async () => {
    const stub = stubFetch([
      { match: "/user/daily/activity", body: litellmActivityBody },
    ]);
    const { context } = await makeSmokeContext();
    const spend = toolByName(
      await loadOneSkill("subscription-usage", context),
      "litellm_spend",
    );

    const summary = JSON.parse(await spend.execute({ days: 2 }));
    expect(summary.totalSpend).toBe(1.75);
    expect(summary.totalRequests).toBe(14);
    expect(summary.days).toEqual([
      { date: "2026-07-26", spend: 1.25, requests: 10, tokens: 1500 },
      { date: "2026-07-27", spend: 0.5, requests: 4, tokens: 600 },
    ]);
    expect(summary.modelSpend).toEqual({
      "anthropic/claude-sonnet-5": 1.5,
      "tier-local": 0.25,
    });
    const url = stub.calls[0] ?? "";
    expect(url).toContain("/user/daily/activity");
    expect(url).toContain("start_date=");
    expect(url).toContain("end_date=");
  });
});

// The smoke fixture ships a far-future Claude expiry; this clone backdates it
// to force the proactive refresh path.
const expiredClaudeContext = (context: SkillContext): SkillContext => ({
  ...context,
  settings: {
    ...context.settings,
    subscriptionUsage: {
      claudeAccounts: [{
        name: "personal",
        credentials: JSON.stringify({
          claudeAiOauth: {
            accessToken: "at-claude-stale",
            refreshToken: "rt-claude",
            expiresAt: 1000,
          },
        }),
      }],
      codexAccounts: [],
    },
  },
});
