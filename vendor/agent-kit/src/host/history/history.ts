import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ChatMessage, ContentBlock } from "../../core/types.js";
import { encodeJson } from "../../store/json.js";
import type { StorePort } from "../../store/types.js";
import { HistoryRowSchema } from "./schema.js";

const DEFAULT_HISTORY_MESSAGE_LIMIT = 20;

/**
 * Durable conversation history (§7.3, §27.1). Append is serialized per
 * conversation via the (conversation_key, seq) PK. On Postgres-at-runtime
 * failure the caller degrades to in-request history (§20), so every method is
 * best-effort from the caller's point of view.
 */
export class HistoryRepo {
  constructor(private readonly store: StorePort) {}

  async load(
    conversationKey: string,
    limit = DEFAULT_HISTORY_MESSAGE_LIMIT,
  ): Promise<ChatMessage[]> {
    const sql = this.store.sql;
    const rows = await this.store.run(
      Effect.flatMap(
        sql`
          SELECT role, content, origin FROM (
            SELECT role, content, origin, seq FROM history
            WHERE conversation_key = ${conversationKey}
            ORDER BY seq DESC LIMIT ${limit}
          ) t ORDER BY seq ASC
        `,
        Schema.decodeUnknownEffect(Schema.Array(HistoryRowSchema)),
      ),
    );
    return rows.map((r) => ({
      role: r.role,
      content: typeof r.content === "string"
        ? r.content
        : decodeBlocks(r.content),
      origin: r.origin,
    }));
  }

  async append(
    conversationKey: string,
    messages: ChatMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;
    const sql = this.store.sql;
    await this.store.run(sql.withTransaction(Effect.gen(function*() {
      const rows = yield* sql<{ next: string | number; }>`
        SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM history WHERE conversation_key = ${conversationKey}
      `;
      let seq = Number(rows[0]?.next ?? 1);
      for (const m of messages) {
        yield* sql`
          INSERT INTO history (conversation_key, seq, role, content, origin)
          VALUES (${conversationKey}, ${seq}, ${m.role},
                  ${sql.json(encodeJson(m.content))}, ${m.origin ?? "internal"})
        `;
        seq++;
      }
    })));
  }
}

function decodeBlocks(
  blocks: Exclude<typeof HistoryRowSchema.Type["content"], string>,
): ContentBlock[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "text": {
        return { type: block.type, text: block.text };
      }
      case "tool_use": {
        return {
          type: block.type,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      case "tool_result": {
        return {
          type: block.type,
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error !== undefined && { is_error: block.is_error }),
        };
      }
    }
  });
}
