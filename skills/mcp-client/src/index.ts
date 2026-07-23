import type {
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { connectMcp } from "./client";
import type { McpConnection } from "./types";

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const results = await Promise.allSettled(
    context.settings.mcp.map(connectMcp),
  );
  const connections: McpConnection[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      connections.push(result.value);
    } else {
      const id = context.settings.mcp[index]?.id ?? "unknown";
      context.report(result.reason, `mcp:${id}`);
    }
  }
  return {
    tools: connections.flatMap((connection) => connection.definitions()),
    services: connections.map(endpointService),
  };
};

const endpointService = (connection: McpConnection): ServiceBinding => ({
  name: `mcp:${connection.settings.id}`,
  start: () => undefined,
  stop: () => connection.close(),
  health: () => ({ tools: connection.tools.length }),
});
