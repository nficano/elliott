/**
 * Runtime plugins (§8.3) — injection screen, approval gate, envelope (M5); the
 * self-improvement observer + reflection (M6).
 */
export {
  Observer,
  proposalsToMarkdown,
  Reflection,
  scaffoldSkill,
} from "./self-improve/index.js";
export type {
  ObserverReport,
  Proposal,
  ProposalType,
  SkillScaffold,
} from "./self-improve/index.js";
export {
  ApprovalGate,
  Envelope,
  InjectionScreen,
  isActionable,
  minTrustOf,
  parseEnvelope,
  withApprovalGate,
} from "./trust/index.js";
export type {
  ApprovalPrompt,
  ScreenDecision,
  ScreenResult,
  StagedAction,
} from "./trust/index.js";
