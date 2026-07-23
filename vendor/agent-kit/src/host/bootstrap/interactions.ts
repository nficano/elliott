import * as Effect from "effect/Effect";
import { ImessageChannel } from "../../channels/imessage.js";
import { SlackChannel } from "../../channels/slack.js";
import { TelegramChannel } from "../../channels/telegram.js";
import type { Channel } from "../../core/channels/types.js";
import { Observer } from "../../plugins/self-improve/observer.js";
import { Reflection } from "../../plugins/self-improve/reflection.js";
import { ApprovalGate as ApprovalGateImpl } from "../../plugins/trust/approval-gate.js";
import { InjectionScreen } from "../../plugins/trust/injection-screen.js";
import type { StorePort } from "../../store/types.js";
import type { AgentKitConfig } from "../config/schema.js";
import { HistoryRepo } from "../history/history.js";
import { resolveModel } from "../model/resolver.js";
import type { Observability } from "../observability/types.js";
import { makeAgentDirectory } from "../runtime/agent-directory.js";
import type { RuntimeEnv } from "../runtime/types.js";
import { PgScheduler } from "../scheduler/scheduler.js";
import type {
  AgentKitOptions,
  Infrastructure,
  InteractionLayer,
  ServiceLayer,
} from "./types.js";

export type { InteractionLayer } from "./types.js";

export function buildInteractionLayer(options: {
  readonly opts: AgentKitOptions;
  readonly infra: Infrastructure;
  readonly services: ServiceLayer;
}): InteractionLayer {
  const { opts, infra, services } = options;
  const channels = buildChannels(infra.cfg);
  const deliver = makeDeliver(channels, infra.obs);
  const { injectionScreen, observer, reflection } = buildSelfImprovement(infra);
  const ownerId = (infra.cfg.channels.telegram?.owner_id as
    | string
    | undefined) ?? "";
  const approvalGate = new ApprovalGateImpl(ownerId);
  const deliverApproval = (text: string): Promise<void> =>
    deliver(`telegram:${ownerId}`, text);
  const scheduler = new PgScheduler(infra.store, infra.obs, services.jobs, {
    timezone: infra.cfg.runtime.timezone,
  });
  const runtimeEnv: RuntimeEnv = {
    agents: makeAgentDirectory(opts.agents),
    history: new HistoryRepo(infra.store),
    deliver,
    injectionScreen,
    observer,
    seenBefore: makeDedupe(infra.store),
    inflight: new Set<string>(),
    ...(opts.hooks && { hooks: opts.hooks }),
  };
  return {
    channels,
    deliver,
    reflection,
    approvalGate,
    deliverApproval,
    scheduler,
    runtimeEnv,
  };
}

function buildSelfImprovement(infra: Infrastructure): {
  readonly injectionScreen: InjectionScreen;
  readonly observer: Observer;
  readonly reflection: Reflection;
} {
  return {
    injectionScreen: new InjectionScreen({
      llm: infra.llm,
      utilityModel: resolveModel({ cfg: infra.cfg, tier: "utility" }),
      layer2: true,
    }),
    observer: new Observer(
      infra.llm,
      resolveModel({ cfg: infra.cfg, tier: "fast" }),
    ),
    reflection: new Reflection(
      infra.llm,
      resolveModel({ cfg: infra.cfg, tier: "deep" }),
      infra.footprint,
      infra.memory,
    ),
  };
}

function telegramChannel(cfg: AgentKitConfig): Channel | undefined {
  const telegram = cfg.channels.telegram;
  if (
    !telegram?.enabled
    || typeof telegram.token !== "string"
    || typeof telegram.owner_id !== "string"
  ) {
    return undefined;
  }
  return new TelegramChannel({
    token: telegram.token,
    ownerId: telegram.owner_id,
  });
}

function slackChannel(cfg: AgentKitConfig): Channel | undefined {
  const slack = cfg.channels.slack;
  if (
    !slack?.enabled
    || (typeof slack.bot_token !== "string"
      && typeof slack.webhook_url !== "string")
  ) {
    return undefined;
  }
  return new SlackChannel(stringFields(slack, {
    bot_token: "botToken",
    webhook_url: "webhookUrl",
    api_base: "apiBase",
    default_channel: "defaultChannel",
    app_token: "appToken",
    owner_id: "ownerId",
  }));
}

/** Copy the string-valued config keys present in `source` onto SDK names. */
function stringFields<K extends string>(
  source: Record<string, unknown>,
  mapping: Record<string, K>,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const [from, to] of Object.entries(mapping)) {
    const value = source[from];
    if (typeof value === "string") out[to] = value;
  }
  return out;
}

function imessageChannel(cfg: AgentKitConfig): Channel | undefined {
  const imessage = cfg.channels.imessage;
  if (!imessage?.enabled || typeof imessage.password !== "string") {
    return undefined;
  }
  return new ImessageChannel({
    password: imessage.password,
    ...(typeof imessage.server_url === "string"
      && { serverUrl: imessage.server_url }),
    ...((imessage.method === "private-api"
      || imessage.method === "apple-script")
      && { method: imessage.method }),
    ...((imessage.service === "SMS" || imessage.service === "iMessage")
      && { service: imessage.service }),
    ...(typeof imessage.default_recipient === "string"
      && { defaultRecipient: imessage.default_recipient }),
  });
}

function buildChannels(cfg: AgentKitConfig): Channel[] {
  return [
    telegramChannel(cfg),
    slackChannel(cfg),
    imessageChannel(cfg),
  ].filter((channel): channel is Channel => channel !== undefined);
}

function makeDeliver(
  channels: Channel[],
  obs: Observability,
): (conversationKey: string, text: string) => Promise<void> {
  const channelMap = new Map(
    channels.map((channel) => [channel.name, channel]),
  );
  return async (conversationKey, text) => {
    const name = conversationKey.split(":", 1)[0]!;
    const channel = channelMap.get(name);
    if (!channel) {
      obs.recordError("ChannelError", `no channel for '${name}'`, {
        "agentkit.conversation": conversationKey,
      });
      return;
    }
    await Effect.runPromise(
      channel.send({ conversationKey, text }).pipe(
        Effect.match({
          onSuccess: () => {},
          onFailure: (error) =>
            obs.recordError("ChannelError", error.message, { channel: name }),
        }),
      ),
    );
  };
}

function makeDedupe(
  store: StorePort,
): (channel: string, externalId: string) => Promise<boolean> {
  return async (channel, externalId) => {
    try {
      const sql = store.sql;
      const rows = await store.run(
        sql<{ existed: boolean; }>`
          INSERT INTO processed_inbound (channel, external_id)
          VALUES (${channel}, ${externalId})
          ON CONFLICT (channel, external_id) DO NOTHING
          RETURNING true AS existed
        `,
      );
      return rows.length === 0;
    } catch {
      return false;
    }
  };
}
