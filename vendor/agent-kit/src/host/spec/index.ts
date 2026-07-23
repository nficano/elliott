/**
 * agent-spec foundation (AGENT-SPEC §1) — the YAML surface that compiles onto
 * the existing runtime: `uses:` ref grammar + lockfile, the spec file schema,
 * `${{ }}` interpolation (load + runtime phases), `permissions:` semantics,
 * the generated model-facing tool file, job compilation/execution, and the
 * `loadAgentSpecs` / `createAgentKitFromSpecs` entrypoints.
 */

export { builtinSkillFactories, builtinSkillIds } from "./builtins.js";
export { loadSpecSecrets, makeSkillCatalog, SpecLoadError } from "./compile.js";
export {
  hasDeferred,
  interpolateSpecTree,
  isDeferredExpr,
  resolveDeferredTree,
  SpecInterpolationError,
} from "./interpolate.js";
export {
  compileJobs,
  makeSpecJobRunner,
  registerSpecJobHandlers,
  SpecJobError,
} from "./jobs.js";
export {
  gitResolver,
  LOCKFILE_NAME,
  parseLockfile,
  RefResolutionError,
  resolveRefs,
  serializeLockfile,
  verifyAgainstHead,
} from "./lock.js";
export type { GitResolver, LockEntry, Lockfile, UsesRef } from "./lock.js";
export {
  compileAgentSpecs,
  createAgentKitFromSpecs,
  loadAgentSpecs,
} from "./load.js";
export {
  applyPermissions,
  materializedTools,
  permissionLevelFor,
} from "./permissions.js";
export { parseUses, toolCandidates, UsesParseError } from "./refs.js";
export type { LocalUses, ParsedUses, RegistryUses } from "./refs.js";
export { AgentSpecFileSchema, parseAgentSpec, SpecValidationError } from "./schema.js";
export { buildToolFile, serializeToolFile } from "./toolfile.js";
export type {
  AgentSpecFile,
  CompileAgentContext,
  CompiledAgent,
  CompiledJob,
  CompiledSpecKit,
  CompiledStep,
  CompiledTurnStep,
  CompiledUsesStep,
  CompileJobsParams,
  DeferredExpr,
  DeferredSegment,
  ExprOperand,
  ExprSegment,
  PathOperand,
  PermissionDecision,
  PermissionLevel,
  PermissionsResult,
  PermissionSummaryEntry,
  ResolvedImport,
  SkillCatalog,
  SpecJob,
  SpecJobDeps,
  SpecJobQueueLike,
  SpecJobTrigger,
  SpecKitOptions,
  SpecLoadContext,
  SpecModelBlock,
  SpecRegistryLike,
  SpecRuntimeContext,
  SpecRuntimeLike,
  SpecStep,
  TextSegment,
  ToolFile,
  ToolFileEntry,
  TurnBlock,
  TurnModelRef,
  TurnStep,
  UsesImport,
  UsesStep,
  ValueOperand,
} from "./types.js";
