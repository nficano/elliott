/**
 * agent-kit — public framework API. A consumer (e.g. agent-oslo) imports
 * `createAgentKit` and supplies config + registrables + agents; agent-kit owns
 * the runtime, registry, router, memory, scheduler, jobs, channels,
 * observability, and self-improvement machinery.
 */
export { createAgentKit, DEFAULT_BUNDLE_ORDER } from "./host/bootstrap.js";
export type { AgentKit, AgentKitOptions } from "./host/bootstrap.js";

// Registrable authoring (§6, §8)
export { define } from "./core/agent/index.js";
export type {
  DefineToolSpec,
  ToolContribution,
  ToolCtx,
  ToolDef,
  ToolMeta,
} from "./core/agent/types.js";
export type {
  ActivateCtx,
  Active,
  Contracts,
  LifecycleHooks,
  Manifest,
  PromptFragment,
  Registrable,
  ScheduleSpec,
  SecretDecl,
} from "./host/registry/types.js";

// Capability layer (CAPABILITIES-TDD): contracts, the bus, chain tracing
export {
  formatChain,
  MAX_CAPABILITY_DEPTH,
  pushHop,
} from "./core/agent/chain.js";
export type { CallChain, Hop, HopKind } from "./core/agent/types.js";
export { applyAnchoredEdits, fencePaths } from "./core/edits.js";
export type { AnchoredEdit, EditResult } from "./core/types.js";
export {
  CapabilityError,
  ContractCatalog,
  degradeForModel,
  makeCapabilityBus,
  makeStandardCatalog,
  refOf,
} from "./host/capabilities/index.js";
export type {
  CapabilityContract,
  CapabilityCtx,
  CapabilityFailure,
  CapabilityInvoker,
  CapabilitySelection,
  ProviderDecl,
  ProviderImpl,
} from "./host/capabilities/index.js";
export {
  highestSatisfying,
  parseSemver,
  satisfies,
} from "./host/registry/semver.js";
export { rotating, taskForDate, weekIndex } from "./host/scheduler/rota.js";
export type { RotaPlan, RotaSlot, RotaTask } from "./host/scheduler/types.js";

// Fleet / dispatch (§17)
export type { AgentDirectory, AgentSpec } from "./host/runtime/types.js";
export type { TurnInput, TurnResult } from "./host/runtime/types.js";

// Core primitives
export {
  BudgetExceeded,
  ChannelError,
  ConfigError,
  LlmError,
  McpError,
  MemoryError,
  StoreError,
  ToolError,
} from "./core/errors.js";
export { guard, guardTool } from "./core/result.js";
export * from "./core/types.js";

// Ports (for advanced consumers building custom registrables)
export type { Channel, Inbound, Outbound } from "./core/channels/types.js";
export type { LlmPort } from "./core/llm/types.js";
export type { McpClient, McpServerConfig } from "./core/mcp/types.js";
export type { Collection, MemoryPort } from "./core/memory/types.js";
export type { NotifyPort, NotifySend } from "./core/notify/types.js";
export type { Job, JobHandler, JobQueue, JobSpec } from "./host/jobs/types.js";
export { encodeJson } from "./store/json.js";
export type {
  MigrateResult,
  ReservedConnection,
  StorePort,
} from "./store/types.js";

// The generic packs (§18, §21; CAPABILITIES-TDD §9) — all disabled by default
export {
  IntegrationError,
  makeGithub,
  makeGoogleAuth,
  makeHttp,
} from "./integrations/index.js";
export {
  analyzeAsk,
  emailPack,
  emailReadSkill,
  emailWriteSkill,
  followupWorthiness,
  GmailClient,
} from "./skills/email/index.js";
export type {
  AskKind,
  AskSignals,
  GmailCreds,
  RecipientRole,
  SenderKind,
  Worthiness,
} from "./skills/email/index.js";
export { githubPack, githubSkill } from "./skills/github/index.js";
export { opsPack, spikeWatchSkill } from "./skills/ops/index.js";
export {
  REMINDER_JOB_KIND,
  remindersPack,
  remindersSkill,
} from "./skills/reminders/index.js";
export { watchPack, watchSkill } from "./skills/watch/index.js";
export {
  braveSkill,
  browserSkill,
  firecrawlSkill,
  pageAuditSkill,
  sitemapSkill,
  webPack,
  webpageSkill,
} from "./skills/web/index.js";
export { youtubePack, youtubeSkill } from "./skills/youtube/index.js";
export {
  compileAgentSpecs,
  createAgentKitFromSpecs,
  loadAgentSpecs,
  parseAgentSpec,
} from "./host/spec/index.js";
export type {
  AgentSpecFile,
  CompiledSpecKit,
  SpecKitOptions,
} from "./host/spec/types.js";

// DI + trust primitives for consumers building custom registrables (§6, §16).
// `Context.Service` classes are `Context.Key`s provided by the app `Layer` (§4);
// reach them via `ctx.get(Svc)` / `kit.get(Svc)` from the shared ManagedRuntime.
export * from "./core/di/services.js";
export {
  proposalsToMarkdown,
  scaffoldSkill,
} from "./plugins/self-improve/index.js";
export {
  ApprovalGate,
  Envelope,
  InjectionScreen,
  isActionable,
  minTrustOf,
  parseEnvelope,
  withApprovalGate,
} from "./plugins/trust/index.js";

// Config loader plumbing for consumers (secret resolvers, §5/§19)
export { envResolver } from "./host/config/interpolate.js";
export type { SecretResolver } from "./host/config/types.js";
