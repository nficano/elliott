import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { LlmPort } from "../../core/llm/types.js";
import type { MemoryPort } from "../../core/memory/types.js";
import type { ModelChoice } from "../../core/types.js";
import type {
  ComponentReport,
  FootprintLedger,
} from "../../host/footprint/types.js";
import { ProposalSchema } from "./schema.js";
import type { Proposal, SkillScaffold } from "./types.js";

/**
 * Nightly reflection (§13). A scheduled agent scans the day's signals, clusters
 * recurring problems, and emits TYPED proposals. It changes nothing directly —
 * each proposal is gated by a dataset A/B (testkit) + a git PR + a human. It runs
 * on the Batch API (nightly deep-tier over a day of traces is the single most
 * expensive line item and has zero latency requirement) and is
 * INACTIVITY-TRIGGERED (fire when idle and last-run > interval), never a rigid
 * cron, so it never interrupts active work.
 */
const REFLECTION_SYSTEM =
  `You are a nightly self-improvement analyst for an agent fleet. You are given: a footprint report
(per-component cold tokens + call counts), and a set of recent learnings (observer reports + corrections).
Cluster recurring problems and propose concrete, MEASURABLE improvements. Rules:
  - tool_prune: a tool with high cold_tokens and ~0 calls over the window → propose dropping it (cite the saving).
  - routing: a task consistently over/under-powered → propose a tier change (config diff).
  - prompt: a recurring failure a wording change fixes → propose the new prompt text.
  - memory: a durable fact worth storing.
  - new_skill: a repeated manual workflow worth a skill (scaffold via the manifest schema).
Propose nothing speculative. Every proposal must be justified by the data you were given.
Respond ONLY with the JSON object {"proposals": [...]}.`;
const PRUNE_COLD_TOKEN_MIN = 100;

export class Reflection {
  constructor(
    private readonly llm: LlmPort,
    private readonly model: ModelChoice,
    private readonly footprint: FootprintLedger,
    private readonly memory?: MemoryPort,
  ) {}

  async reflect(): Promise<Proposal[]> {
    const report = await this.footprint.report();
    // Deterministic pruning candidates (no model needed) — cold tokens, zero calls.
    const pruneCandidates = report
      .filter((r) => r.coldTokens > PRUNE_COLD_TOKEN_MIN && r.calls === 0)
      .map((r) =>
        `${r.componentId}: ${r.coldTokens} cold tokens, ${r.calls} calls`
      );

    const learnings = this.memory
      ? await Effect.runPromise(
        this.memory
          .recall({
            text: "recurring problems and corrections",
            collections: ["learnings"],
            k: 20,
          })
          .pipe(Effect.match({
            onSuccess: (recs) => recs.map((r) => r.preview),
            onFailure: () => [],
          })),
      )
      : [];

    const body = reflectionBody({ report, pruneCandidates, learnings });

    const text = await Effect.runPromise(
      this.llm
        .complete({
          model: this.model, // routes through the Batch API in production (§13)
          system: REFLECTION_SYSTEM,
          messages: [{ role: "user", content: body }],
          tools: [],
          cacheBreakpoint: false,
        })
        .pipe(Effect.match({
          onSuccess: (r) => r.text,
          onFailure: () => "{\"proposals\":[]}",
        })),
    );

    return parseProposals(text);
  }
}

function reflectionBody(params: {
  readonly report: readonly ComponentReport[];
  readonly pruneCandidates: readonly string[];
  readonly learnings: readonly string[];
}): string {
  const report = params.report.map((row) =>
    `${row.componentId}: cold=${row.coldTokens} calls=${row.calls} err=${
      row.errorRate.toFixed(2)
    }`
  ).join("\n");
  return `## Footprint report\n${report}\n\n`
    + `## Prune candidates (cold, unused)\n${
      params.pruneCandidates.join("\n") || "(none)"
    }\n\n`
    + `## Recent learnings\n${params.learnings.join("\n") || "(none)"}`;
}

export function parseProposals(text: string): Proposal[] {
  const parsed = Schema.decodeUnknownResult(
    Schema.fromJsonString(ProposalSchema),
  )(extractJson(text));
  return Result.isSuccess(parsed) ? [...parsed.success.proposals] : [];
}

/**
 * `skill-creator` (§13) — author a schema-valid SKILL.md from the §8.1 manifest
 * schema, so agent-authored skills are valid by construction. Skill maintenance
 * ARCHIVES, never deletes; touches only agent-created skills; respects pins.
 */
export function scaffoldSkill(s: SkillScaffold): string {
  const frontmatter = [
    "---",
    `id: ${s.id}`,
    `description: ${JSON.stringify(s.description)}`,
    `bundle: ${s.bundle}`,
    `tier: ${s.tier}`,
    "agent_created: true", // marks it as archive-eligible / auto-maintainable (§13)
    ...(s.requires ? [`requires: ${JSON.stringify(s.requires)}`] : []),
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${s.body}\n`;
}

/** Render proposals as a PR body — the single gate + single source of truth (§13). */
export function proposalsToMarkdown(proposals: Proposal[]): string {
  if (proposals.length === 0) return "_No proposals this cycle._";
  return proposals
    .map(
      (p, i) =>
        `### ${i + 1}. ${p.type} — \`${p.target}\`\n${p.rationale}`
        + (p.estSavingColdTokens
          ? `\n\n_Est. saving: ${p.estSavingColdTokens} cold tokens._`
          : "")
        + (p.change ? `\n\n\`\`\`\n${p.change}\n\`\`\`` : ""),
    )
    .join("\n\n");
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}
