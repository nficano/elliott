import type { AgentDirectory, AgentSpec } from "./types.js";

/**
 * Default resolution: explicit id > an agent named "main" > the only agent
 * registered. A single-agent consumer (every spec-driven app so far) must not
 * need to name its agent "main" for inbound chat to route — that was the
 * "no agent 'main' and no default" failure on oslo's first Slack message.
 */
export function makeAgentDirectory(
  specs: AgentSpec[],
  defaultAgentId?: string,
): AgentDirectory {
  const byId = new Map(specs.map((s) => [s.id, s]));
  return {
    resolve: (id) => byId.get(id),
    defaultAgentId: defaultAgentId
      ?? (byId.has("main") || specs.length !== 1 ? "main" : specs[0]!.id),
  };
}
