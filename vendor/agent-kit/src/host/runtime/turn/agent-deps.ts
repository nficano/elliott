import type { RunAgentDeps } from "../../../core/agent/types.js";
import { estimateCost } from "../../model/pricing.js";
import type { AgentDepsOptions } from "./types.js";

const ESTIMATED_CHARS_PER_TOKEN = 4;

export function createAgentDeps(options: AgentDepsOptions): RunAgentDeps {
  const { env, footprint, llm, obs, observeRoundEffect } = options;
  return {
    llm,
    obs,
    estimateCost,
    recordTool: (sample) =>
      void footprint.recordDynamic({
        componentId: sample.componentId,
        toolMs: sample.toolMs,
        inTokensEst: 0,
        outTokensEst: Math.ceil(
          sample.outputBytes / ESTIMATED_CHARS_PER_TOKEN,
        ),
        usdEst: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        error: sample.error,
      }),
    ...(observeRoundEffect && { observeRoundEffect }),
    ...(env.hooks && { hooks: env.hooks }),
  };
}
