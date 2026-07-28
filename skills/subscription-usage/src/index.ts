import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema } from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  SubscriptionUsageSettings,
  ToolDefinition,
} from "../../../src/runtime/types";
import { claudeUsage } from "./claude";
import { codexUsage } from "./codex";
import { litellmSpendTool } from "./litellm";
import { makeTokenStore } from "./tokens";
import type { AccountUsage, TokenStore, UsageTarget } from "./types";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.subscriptionUsage;
  if (settings === undefined) return {};
  const tools: ToolDefinition[] = [];
  if (settings.claudeAccounts.length + settings.codexAccounts.length > 0) {
    tools.push(usageTool(settings, makeTokenStore(context.stateDirectory)));
  }
  if (settings.litellm !== undefined) {
    tools.push(litellmSpendTool(settings.litellm));
  }
  return { tools };
};

const usageTool = (
  settings: SubscriptionUsageSettings,
  store: TokenStore,
): ToolDefinition => ({
  name: "subscription_usage",
  description: "Check how much of each Claude (Pro/Max) and Codex (ChatGPT) "
    + "subscription is used right now: the 5-hour session window and weekly "
    + "windows per account, with reset times. Optionally filter by provider "
    + "(claude or codex) or account name. An account that fails reports its "
    + "error inline; the others still return.",
  inputSchema: objectSchema({
    provider: { type: "string", enum: ["claude", "codex"] },
    account: { type: "string" },
  }, []),
  execute: async (input) => {
    const selected = targets(settings, input);
    if (selected.length === 0) {
      throw new Error("No configured subscription account matches the filter");
    }
    const results = await Promise.all(
      selected.map((target) => guardedUsage(target, store)),
    );
    return JSON.stringify(results);
  },
});

const targets = (
  settings: SubscriptionUsageSettings,
  input: unknown,
): readonly UsageTarget[] => {
  const provider = optionalField(input, "provider");
  const account = optionalField(input, "account");
  const all: readonly UsageTarget[] = [
    ...settings.claudeAccounts.map((item) =>
      ({ provider: "claude", account: item }) as const
    ),
    ...settings.codexAccounts.map((item) =>
      ({ provider: "codex", account: item }) as const
    ),
  ];
  return all.filter((item) =>
    (provider === undefined || item.provider === provider)
    && (account === undefined || item.account.name === account)
  );
};

const guardedUsage = async (
  target: UsageTarget,
  store: TokenStore,
): Promise<AccountUsage> => {
  const fetchUsage = target.provider === "claude" ? claudeUsage : codexUsage;
  try {
    return await fetchUsage(target.account, store);
  } catch (error) {
    return {
      provider: target.provider,
      account: target.account.name,
      windows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const optionalField = (input: unknown, key: string): string | undefined => {
  if (!isJsonRecord(input)) return undefined;
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
