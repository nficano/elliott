/**
 * Provider-agnostic ChatMessage[] → OpenAI-compatible wire (§7.1). LiteLLM
 * speaks OpenAI; Anthropic prompt caching rides through as `cache_control` on the
 * system block. The prefix order is tools → system → messages so the cache stays
 * warm (§10.1).
 */
import type { ChatMessage, ContentBlock, ToolUseBlock } from "../types.js";
import type { ToolSchema, WireMessage } from "./types.js";

export function toWireTools(tools: ToolSchema[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function toWireSystem(system: string, cache: boolean): WireMessage {
  if (!cache) return { role: "system", content: system };
  // Mark the cache breakpoint on the system block — covers the tools+system prefix.
  return {
    role: "system",
    content: [{
      type: "text",
      text: system,
      cache_control: { type: "ephemeral" },
    }],
  };
}

export function toWireMessages(messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.tool_call_id ?? "",
        content: stringContent(m.content),
      });
      continue;
    }
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    // ContentBlock[]: split tool_use blocks into tool_calls; tool_result → tool msgs.
    const text = m.content.filter((
      b,
    ): b is Extract<ContentBlock, { type: "text"; }> => b.type === "text");
    const toolUse = m.content.filter((b): b is ToolUseBlock =>
      b.type === "tool_use"
    );
    const toolResult = m.content.filter((b) => b.type === "tool_result");

    if (m.role === "assistant") {
      const msg: WireMessage = {
        role: "assistant",
        content: text.map((b) => b.text).join("") || null,
      };
      if (toolUse.length > 0) {
        msg.tool_calls = toolUse.map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }
      out.push(msg);
    }
    for (const tr of toolResult) {
      if (tr.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }
    }
  }
  return out;
}

function stringContent(c: string | ContentBlock[]): string {
  if (typeof c === "string") return c;
  return c
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_result") return b.content;
      return "";
    })
    .join("");
}

export function buildRequestBody(args: {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  toolChoice: "auto" | "none" | { name: string; } | undefined;
  maxTokens: number;
  temperature: number;
  stream: boolean;
  cache: boolean;
}): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    model: args.model,
    messages: [
      toWireSystem(args.system, args.cache),
      ...toWireMessages(args.messages),
    ],
    max_tokens: args.maxTokens,
    temperature: args.temperature,
  };
  if (args.tools.length > 0) wire.tools = toWireTools(args.tools);
  if (args.toolChoice === "none") wire.tool_choice = "none";
  else if (typeof args.toolChoice === "object") {
    wire.tool_choice = {
      type: "function",
      function: { name: args.toolChoice.name },
    };
  } else if (args.tools.length > 0) wire.tool_choice = "auto";
  if (args.stream) {
    wire.stream = true;
    wire.stream_options = { include_usage: true };
  }
  return wire;
}
