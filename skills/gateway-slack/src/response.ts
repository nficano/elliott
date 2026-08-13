import type { GatewayResponse } from "../../../src/runtime/skills/types";
import type {
  TurnObserver,
  TurnToolProgress,
} from "../../../src/runtime/types";
import { agentMessageBlocks, responseFooterBlocks } from "./blocks";
import { postMessage } from "./client";
import {
  sanitizeSlackDisplayPayload,
  sanitizeSlackEmoji,
  SlackEmojiStreamFilter,
} from "./emoji";
import { taskTitle, threadTitle } from "./text";
import type { SlackAgentResponseOptions, SlackJson } from "./types";

const STREAM_FLUSH_CHARACTERS = 2000;
const STREAM_FLUSH_MILLISECONDS = 250;

export class SlackAgentResponse implements GatewayResponse {
  readonly observer: TurnObserver;
  readonly #options: SlackAgentResponseOptions;
  #stream: string | undefined;
  #buffer = "";
  #receivedText = "";
  #deliveredCharacters = 0;
  #pending = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #emojiFilter = new SlackEmojiStreamFilter();

  constructor(options: SlackAgentResponseOptions) {
    this.#options = options;
    this.observer = {
      onTextDelta: (delta) => this.#onTextDelta(delta),
      onToolProgress: (progress) => this.#onToolProgress(progress),
    };
  }

  async start(): Promise<void> {
    const thread = this.#thread();
    if (thread !== undefined && this.#isDirectMessage()) {
      // assistant.threads.* exists only on the assistant (DM) surface; in
      // channel threads Slack rejects it with missing_scope.
      if (this.#options.message.threadRoot === true) {
        await this.#request("assistant.threads.setTitle", {
          channel_id: this.#options.message.channel,
          thread_ts: thread,
          title: threadTitle(this.#options.message.text),
        });
      }
      await this.#request("assistant.threads.setStatus", {
        channel_id: this.#options.message.channel,
        thread_ts: thread,
        status: "Thinking…",
        loading_messages: [
          "Understanding your request…",
          "Checking the connected tools…",
          "Working through the details…",
        ],
      });
    }
    // A stream is locked to one content mode by its first payload: task/plan
    // chunks or markdown text, never both (Slack rejects the other kind with
    // streaming_mode_mismatch). This response streams model text, so the
    // stream starts bare and every append stays markdown_text. Channel
    // streams also require the recipient pair or Slack refuses to start.
    const started = await this.#request("chat.startStream", {
      channel: this.#options.message.channel,
      ...(thread !== undefined && { thread_ts: thread }),
      ...this.#channelRecipients(),
    });
    const timestamp = started?.["ts"];
    if (typeof timestamp === "string") this.#stream = timestamp;
  }

  async complete(text: string): Promise<void> {
    try {
      if (this.#receivedText.length === 0) {
        this.#receivedText = text;
        this.#buffer = text;
      }
      await this.#finishQueuedText();
      if (this.#stream === undefined) {
        await this.#postFallback(text);
        return;
      }
      const remaining = this.#receivedText.slice(this.#deliveredCharacters);
      const stopped = await this.#request("chat.stopStream", {
        channel: this.#options.message.channel,
        ts: this.#stream,
        ...(remaining.length > 0
          && { markdown_text: sanitizeSlackEmoji(remaining) }),
        blocks: responseFooterBlocks(),
      });
      if (stopped === undefined) await this.#postFallback(text);
    } finally {
      await this.#clearStatus();
    }
  }

  async fail(message: string): Promise<void> {
    try {
      await this.#finishQueuedText();
      if (this.#stream === undefined) {
        await this.#postFallback(message);
        return;
      }
      const partial = this.#receivedText.slice(this.#deliveredCharacters);
      const explanation = sanitizeSlackEmoji(
        `${partial}\n\n:triangle-warn: ${message}`,
      );
      const stopped = await this.#request("chat.stopStream", {
        channel: this.#options.message.channel,
        ts: this.#stream,
        markdown_text: explanation,
        blocks: responseFooterBlocks(),
      });
      if (stopped === undefined) await this.#postFallback(message);
    } finally {
      await this.#clearStatus();
    }
  }

  async #onTextDelta(delta: string): Promise<void> {
    this.#receivedText += delta;
    this.#buffer += delta;
    if (this.#buffer.length >= STREAM_FLUSH_CHARACTERS) {
      await this.#flush();
      return;
    }
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#flush();
      }, STREAM_FLUSH_MILLISECONDS);
    }
  }

  // Tool progress cannot ride the stream: task_update chunks would flip it
  // into task mode and every later text append would fail with
  // streaming_mode_mismatch. Progress surfaces through the assistant thread
  // status line instead, which only exists for DM threads.
  async #onToolProgress(progress: TurnToolProgress): Promise<void> {
    await this.#flush();
    const thread = this.#thread();
    if (thread === undefined || !this.#isDirectMessage()) return;
    const status = progress.status === "in_progress"
      ? `Working: ${taskTitle(progress.name)}…`
      : "Thinking…";
    await this.#queueRequest("assistant.threads.setStatus", {
      channel_id: this.#options.message.channel,
      thread_ts: thread,
      status,
    });
  }

  async #finishQueuedText(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#flush();
    await this.#queueFilteredText(this.#emojiFilter.finish());
    await this.#pending;
  }

  async #flush(): Promise<void> {
    const chunk = this.#buffer;
    this.#buffer = "";
    if (chunk.length === 0 || this.#stream === undefined) return;
    await this.#queueText(chunk);
  }

  async #queueText(text: string): Promise<void> {
    await this.#queueFilteredText(this.#emojiFilter.push(text));
  }

  async #queueFilteredText(
    filtered: {
      readonly text: string;
      readonly sourceLength: number;
    },
  ): Promise<void> {
    if (filtered.sourceLength === 0) return;
    await this.#queue(async () => {
      if (filtered.text.length === 0) {
        this.#deliveredCharacters += filtered.sourceLength;
        return;
      }
      const response = await this.#options.client.request("chat.appendStream", {
        channel: this.#options.message.channel,
        ts: this.#stream,
        markdown_text: filtered.text,
      });
      if (response["ok"] === true) {
        this.#deliveredCharacters += filtered.sourceLength;
      }
    }, "slack:stream:append");
  }

  async #queueRequest(method: string, body: SlackJson): Promise<void> {
    await this.#queue(async () => {
      await this.#options.client.request(
        method,
        sanitizeSlackDisplayPayload(body),
      );
    }, `slack:${method}`);
  }

  async #queue(
    operation: () => Promise<void>,
    mechanism: string,
  ): Promise<void> {
    this.#pending = this.#pending.then(operation).catch((error: unknown) => {
      this.#options.report(error, mechanism);
    });
    await this.#pending;
  }

  async #request(
    method: string,
    body: SlackJson,
  ): Promise<SlackJson | undefined> {
    try {
      return await this.#options.client.request(
        method,
        sanitizeSlackDisplayPayload(body),
      );
    } catch (error) {
      this.#options.report(error, `slack:${method}`);
      return undefined;
    }
  }

  async #postFallback(text: string): Promise<void> {
    const thread = this.#thread();
    await postMessage(this.#options.client, {
      channel: this.#options.message.channel,
      ...(thread !== undefined && { thread_ts: thread }),
      text,
      blocks: agentMessageBlocks(text),
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  async #clearStatus(): Promise<void> {
    const thread = this.#thread();
    if (thread === undefined || !this.#isDirectMessage()) return;
    await this.#request("assistant.threads.setStatus", {
      channel_id: this.#options.message.channel,
      thread_ts: thread,
      status: "",
    });
  }

  #isDirectMessage(): boolean {
    return this.#options.message.channel.startsWith("D");
  }

  // Slack refuses to start a channel stream without the recipient pair
  // (missing_recipient_team_id / missing_recipient_user_id); DMs infer both.
  #channelRecipients(): SlackJson {
    if (this.#isDirectMessage()) return {};
    const team = this.#options.message.team;
    if (team === undefined) return {};
    return {
      recipient_team_id: team,
      recipient_user_id: this.#options.message.sender,
    };
  }

  // With reply_in_thread disabled, answers to top-level channel messages go
  // to the channel itself. DMs and messages already inside a thread keep
  // threading: the assistant surface requires it, and a thread conversation
  // must stay where it started.
  #thread(): string | undefined {
    const inChannel = !this.#options.message.channel.startsWith("D");
    if (
      this.#options.replyInThread === false && inChannel
      && this.#options.message.threadRoot === true
    ) return undefined;
    return this.#options.message.thread ?? this.#options.message.id;
  }
}
