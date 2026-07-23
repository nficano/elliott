export interface ObserverReport {
  readonly trigger: "compounding_mistake" | "missed_constraint" | "prior_art";
  readonly message: string;
}

export type ProposalType =
  | "tool_prune"
  | "routing"
  | "prompt"
  | "memory"
  | "new_skill";

export interface Proposal {
  readonly type: ProposalType;
  readonly target: string; // component id / tool name / prompt file
  readonly rationale: string;
  /** A config/prompt diff or a scaffolded skill body — the PR content. */
  readonly change?: string | undefined;
  /** Estimated cold-token / cost saving, for ranking (§11). */
  readonly estSavingColdTokens?: number | undefined;
}

export interface SkillScaffold {
  readonly id: string; // kebab-case, §26
  readonly description: string;
  readonly bundle: string;
  readonly tier: string;
  readonly body: string; // the prose/command body
  readonly requires?: { bins?: string[]; env?: string[]; config?: string[]; };
}
