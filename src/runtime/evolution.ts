/* eslint-disable max-lines, max-lines-per-function, max-statements, complexity, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { hashValue } from "../core/digest";
import type { AgentKernel } from "../kernel";
import {
  makeEvolutionAgentOperations,
} from "../learning/evolution/agent-operations/index";
import {
  makeHttpTrustedCodeChecker,
} from "../learning/evolution/application/code-checker";
import {
  loadFileEvolutionDefaultSources,
  makeActiveEvolutionPromptDecorator,
  makeActiveEvolutionSkillDecorator,
  makeActiveEvolutionToolDecorator,
  makeEvolutionRuntimeToolTargetResolver,
  makeEvolutionRuntimeTurnTargetResolver,
  makeFileEvolutionDatasetFactory,
  makeFileEvolutionTargetCatalog,
} from "../learning/evolution/application/files";
import {
  makeEvolutionOperatorExecutor,
} from "../learning/evolution/application/index";
import type {
  EvolutionIndependentEvaluatorShape,
} from "../learning/evolution/application/types";
import {
  makeFileEvolutionCandidateValidator,
} from "../learning/evolution/application/validation";
import { makeEvolutionControlPlane } from "../learning/evolution/cli/control-plane";
import type {
  EvolutionControlAuthority,
  EvolutionControlAuthorityResolver,
  EvolutionControlPlaneExecutor,
} from "../learning/evolution/cli/types";
import {
  FileEvolutionProjectionStore,
} from "../learning/evolution/continuous/projections";
import {
  makeHttpOptimizationEngine,
  unavailableOptimizationEngine,
} from "../learning/evolution/engine/http";
import {
  EvolutionAuthorityError,
  EvolutionEvaluationError,
} from "../learning/evolution/errors";
import {
  makeRuntimeEvolutionBaselineController,
} from "../learning/evolution/evaluation/baseline";
import {
  makeFileBaselineEvaluationCache,
  makeFileEvaluationCache,
  withIndependentEvaluatorCache,
} from "../learning/evolution/evaluation/cache";
import { makeEvaluationHarness } from "../learning/evolution/evaluation/harness";
import {
  makeHttpIndependentEvaluator,
  unavailableIndependentEvaluator,
} from "../learning/evolution/evaluation/http";
import {
  makeRuntimeEvolutionEvaluationRequestFactory,
} from "../learning/evolution/evaluation/runtime";
import {
  OptimizationEngineCapabilities,
  OptimizationEngineResult,
} from "../learning/evolution/model/index";
import { makeEvolutionOrchestrator } from "../learning/evolution/orchestrator/index";
import { makeRuntimeEvolutionReleaseBinding } from "../learning/evolution/release/runtime";
import {
  makeEvolutionBaselineReportStore,
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseMonitorReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "../learning/evolution/store/index";
import type {
  EvolutionRunId,
  EvolutionRunStoreShape,
  OptimizationEngineShape,
} from "../learning/evolution/types";
import { FileProposalStore } from "../learning/proposals/index";
import { isJsonRecord } from "../providers/http";
import { makeRuntimeContinuousEvolutionService } from "./evolution-scheduler";
import type { RuntimeEvolutionIntegration, RuntimeSettings } from "./types";
import type { ToolDefinition } from "./types";

const safeTokenEqual = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
};

export const makeBearerEvolutionAuthorityResolver = (
  token: string,
  principalId: string,
  capabilities: readonly string[],
  currentSnapshotId: () => string | undefined,
): EvolutionControlAuthorityResolver => ({
  resolve: (request) => {
    const authorization = request.headers.get("authorization");
    const snapshotId = currentSnapshotId();
    if (
      authorization === null
      || !safeTokenEqual(authorization, `Bearer ${token}`)
      || snapshotId === undefined
    ) {
      return Promise.reject(EvolutionAuthorityError.make({
        principalId,
        action: "resolve-evolution-control-authority",
        reason: "valid bearer authority and an active Snapshot are required",
      }));
    }
    const granted = new Set(capabilities);
    return Promise.resolve({
      principalId,
      snapshotId,
      authorize: async (capability) => granted.has(capability),
    });
  },
});

const routeToken = (
  route: "text" | "code",
  result: OptimizationEngineResult,
): OptimizationEngineResult =>
  result.resumeToken === undefined
    ? result
    : OptimizationEngineResult.make({
      ...result,
      resumeToken: `${route}:${result.resumeToken}`,
    });

const engineForRun = (
  runs: EvolutionRunStoreShape,
  text: OptimizationEngineShape,
  code: OptimizationEngineShape,
  runId: EvolutionRunId,
) =>
  runs.get(runId).pipe(
    Effect.map((run) =>
      run.target.targetClass === "code"
        ? { engine: code, route: "code" as const }
        : { engine: text, route: "text" as const }
    ),
  );

const makeRuntimeOptimizationEngine = (
  runs: EvolutionRunStoreShape,
  text: OptimizationEngineShape,
  code: OptimizationEngineShape,
): OptimizationEngineShape => ({
  describeCapabilities: () =>
    Effect.succeed(OptimizationEngineCapabilities.make({
      engineRef: "elliott/runtime-evolution-router",
      engineKinds: ["gepa", "miprov2", "darwinian"],
      targetClasses: [
        "skill",
        "tool-description",
        "prompt-segment",
        "code",
      ],
      pauseResume: true,
      isolation: "container",
      maximumCandidates: 40,
    })),
  optimize: (request) => {
    const route = request.run.target.targetClass === "code" ? "code" : "text";
    return (route === "code" ? code : text).optimize(request).pipe(
      Effect.map((result) => routeToken(route, result)),
    );
  },
  pause: (runId) =>
    engineForRun(runs, text, code, runId).pipe(
      Effect.flatMap(({ engine, route }) =>
        engine.pause(runId).pipe(
          Effect.map((token) => `${route}:${token}`),
        )
      ),
    ),
  resume: (resumeToken) => {
    const separator = resumeToken.indexOf(":");
    if (separator === -1) {
      return unavailableOptimizationEngine(
        "elliott/runtime-evolution-router",
        "resume token has no engine route",
      ).resume(resumeToken);
    }
    const route = resumeToken.slice(0, separator);
    const token = resumeToken.slice(separator + 1);
    if (route !== "text" && route !== "code") {
      return unavailableOptimizationEngine(
        "elliott/runtime-evolution-router",
        "resume token has an unknown engine route",
      ).resume(token);
    }
    return (route === "code" ? code : text).resume(token).pipe(
      Effect.map((result) => routeToken(route, result)),
    );
  },
  cancel: (runId) =>
    engineForRun(runs, text, code, runId).pipe(
      Effect.flatMap(({ engine }) => engine.cancel(runId)),
    ),
});

const agentBackend = (
  executor: EvolutionControlPlaneExecutor,
  snapshotId: () => string | undefined,
  capabilities: readonly string[],
) => {
  const granted = new Set(capabilities);
  const authority = (): EvolutionControlAuthority => ({
    principalId: "workspace/agent/elliott",
    snapshotId: snapshotId() ?? "unavailable",
    authorize: async (capability) => granted.has(capability),
  });
  const execute = async (
    capability: string,
    operation: Parameters<EvolutionControlPlaneExecutor["execute"]>[1],
  ) => {
    const resolved = authority();
    if (
      resolved.snapshotId === "unavailable"
      || !(await resolved.authorize(capability, operation.arguments))
    ) {
      throw new Error(`Agent lacks ${capability}`);
    }
    return executor.execute(resolved, operation);
  };
  return {
    inspectTarget: (targetRef: string) =>
      execute("evolution.target.read", {
        operation: "evolution.inspect",
        arguments: [targetRef],
      }),
    requestRun: (targetRef: string) =>
      execute("evolution.engine.invoke", {
        operation: "evolution.run",
        arguments: [targetRef],
      }),
    getStatus: (runId: string) =>
      execute("evolution.run.read", {
        operation: "evolution.status",
        arguments: [runId],
      }),
    requestProposal: (runId: string, candidateId: string) =>
      execute("proposal.author", {
        operation: "evolution.propose",
        arguments: [runId, "--candidate", candidateId],
      }),
  };
};

export const makeRuntimeEvolutionIntegration = async (
  root: string,
  settings: RuntimeSettings,
  kernel: AgentKernel,
  currentSnapshotId: () => string | undefined,
  publishSnapshotId: (snapshotId: string) => void,
  runtimeTools: readonly ToolDefinition[],
  notify?: (message: string) => Promise<void>,
): Promise<RuntimeEvolutionIntegration | undefined> => {
  const config = settings.evolution;
  const runtime = settings.evolutionRuntime;
  if (config === undefined || runtime === undefined) return undefined;

  const stateRoot = path.join(settings.stateDirectory, "evolution");
  const runs = makeEvolutionRunStore(stateRoot);
  const candidates = makeEvolutionCandidateStore(stateRoot);
  const baselineReports = makeEvolutionBaselineReportStore(stateRoot);
  const datasets = makeEvolutionDatasetStore(stateRoot);
  const reports = makeEvolutionEvaluationReportStore(stateRoot);
  const releases = makeEvolutionReleaseStore(stateRoot);
  const monitorReports = makeEvolutionReleaseMonitorReportStore(stateRoot);
  const dspy = runtime.dspyEndpoint === undefined
    ? unavailableOptimizationEngine(
      config.engines.text.primary,
      "ELLIOTT_EVOLUTION_DSPY_URL is not configured",
    )
    : makeHttpOptimizationEngine({
      endpoint: runtime.dspyEndpoint,
      engineRef: config.engines.text.primary,
      capabilities: OptimizationEngineCapabilities.make({
        engineRef: config.engines.text.primary,
        engineKinds: ["gepa", "miprov2"],
        targetClasses: ["skill", "tool-description", "prompt-segment"],
        pauseResume: true,
        isolation: "container",
        maximumCandidates: config.budgets.perRun.candidates,
      }),
    });
  const darwinian = runtime.darwinianEndpoint === undefined
    ? unavailableOptimizationEngine(
      config.engines.code.primary,
      "ELLIOTT_EVOLUTION_DARWINIAN_URL is not configured",
    )
    : makeHttpOptimizationEngine({
      endpoint: runtime.darwinianEndpoint,
      engineRef: config.engines.code.primary,
      capabilities: OptimizationEngineCapabilities.make({
        engineRef: config.engines.code.primary,
        engineKinds: ["darwinian"],
        targetClasses: ["code"],
        pauseResume: true,
        isolation: "container",
        maximumCandidates: config.budgets.perRun.candidates,
      }),
    });
  const engine = makeRuntimeOptimizationEngine(
    runs,
    dspy,
    darwinian,
  );
  const unavailableCaseExecutor = {
    execute: () =>
      EvolutionEvaluationError.make({
        evaluatorRef: "organization/evaluator/independent",
        operation: "evaluate-case",
        cause:
          "runtime comparisons use the independently configured evaluator route",
      }),
  };
  const orchestrator = makeEvolutionOrchestrator({
    runs,
    candidates,
    datasets,
    reports,
    engine,
    harness: makeEvaluationHarness(unavailableCaseExecutor),
    records: kernel.records,
    candidateValidator: makeFileEvolutionCandidateValidator(
      runtime.candidateCheckEndpoint === undefined
        ? undefined
        : makeHttpTrustedCodeChecker(runtime.candidateCheckEndpoint),
    ),
  });
  const proposalStore = await FileProposalStore.open({
    root: path.join(settings.stateDirectory, "proposals"),
    records: kernel.records,
  });
  const uncachedEvaluator: EvolutionIndependentEvaluatorShape =
    runtime.evaluatorEndpoint === undefined
      ? unavailableIndependentEvaluator(
        "ELLIOTT_EVOLUTION_EVALUATOR_URL is not configured",
      )
      : makeHttpIndependentEvaluator({ endpoint: runtime.evaluatorEndpoint });
  const evaluator = withIndependentEvaluatorCache(
    uncachedEvaluator,
    makeFileEvaluationCache(stateRoot),
    makeFileBaselineEvaluationCache(stateRoot),
  );
  const releaseBinding = makeRuntimeEvolutionReleaseBinding({
    stateRoot: path.join(stateRoot, "target-revisions"),
    workspaceId: "elliott",
    snapshots: kernel.snapshots,
    epochs: kernel.epochs,
    records: kernel.records,
    proposals: proposalStore,
    runs,
    candidates,
    reports,
    releases,
    currentSnapshotId,
    publishSnapshotId,
    ...(notify !== undefined && { notify }),
    canary: async (release) => {
      if (runtime.canaryEndpoint === undefined) return false;
      const response = await fetch(
        new URL("/v1/canary", runtime.canaryEndpoint),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(release),
        },
      );
      if (!response.ok) return false;
      const value: unknown = await response.json();
      return isJsonRecord(value)
        && value["passed"] === true
        && value["snapshotId"] === release.snapshotId;
    },
  });
  const decorateTools = await makeActiveEvolutionToolDecorator(
    root,
    releaseBinding.targets,
  );
  const decoratePersona = await makeActiveEvolutionPromptDecorator(
    root,
    releaseBinding.targets,
  );
  const activeSkills = await makeActiveEvolutionSkillDecorator(
    root,
    releaseBinding.targets,
  );
  const targetsForTool = await makeEvolutionRuntimeToolTargetResolver(
    root,
    releaseBinding.targets,
    runtimeTools,
  );
  const turnTargets = await makeEvolutionRuntimeTurnTargetResolver(
    root,
    releaseBinding.targets,
  );
  const targets = makeFileEvolutionTargetCatalog(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
    releaseBinding.targets,
    runtimeTools,
  );
  const defaultSources = await loadFileEvolutionDefaultSources(root);
  const evolutionEnvironmentDigest = hashValue({
    environment: settings.environment,
    release: settings.release,
    model: settings.model,
    evolutionConfiguration: config,
  });
  const baselineController = makeRuntimeEvolutionBaselineController({
    evaluator,
    reports: baselineReports,
    records: kernel.records,
    evaluatorRef: "organization/evaluator/agent-benchmarks",
    ...(runtime.authoringRouteDigest !== undefined && {
      authoringRouteDigest: runtime.authoringRouteDigest,
    }),
    ...(runtime.evaluationRouteDigest !== undefined && {
      evaluationRouteDigest: runtime.evaluationRouteDigest,
    }),
    environmentDigest: evolutionEnvironmentDigest,
  });
  const executor = makeEvolutionOperatorExecutor({
    config,
    configurationDigest: hashValue(config),
    orchestrator,
    runs,
    candidates,
    datasets,
    reports,
    releases,
    proposalStore,
    projections: new FileEvolutionProjectionStore(
      path.join(stateRoot, "projections"),
    ),
    targets,
    datasetFactory: makeFileEvolutionDatasetFactory(
      root,
      config.evaluation.split,
      {
        sessionDatabase: path.join(settings.stateDirectory, "sessions.sqlite"),
        defaultSources,
        runtimeTools,
      },
    ),
    evaluationRequestFactory: makeRuntimeEvolutionEvaluationRequestFactory({
      snapshots: kernel.snapshots,
      targets,
      evaluatorRef: "organization/evaluator/agent-benchmarks",
      ...(runtime.authoringRouteDigest !== undefined && {
        authoringRouteDigest: runtime.authoringRouteDigest,
      }),
      ...(runtime.evaluationRouteDigest !== undefined && {
        evaluationRouteDigest: runtime.evaluationRouteDigest,
      }),
      environmentDigest: evolutionEnvironmentDigest,
    }),
    evaluator,
    baselineController,
    releaseController: releaseBinding.controller,
  });
  const continuousService = makeRuntimeContinuousEvolutionService({
    root,
    stateRoot,
    timeZone: settings.timezone,
    config,
    runtime,
    kernel,
    executor,
    targets,
    currentSnapshotId,
    environmentDigest: evolutionEnvironmentDigest,
    proposals: proposalStore,
    releases,
    reports,
    baselineReports,
    monitorReports,
    ...(notify !== undefined && { notify }),
  });
  return {
    decorateTools,
    decoratePersona: (personaPath, baselineContent) => {
      const prompt = decoratePersona(personaPath, baselineContent);
      return () => [prompt(), activeSkills()].filter(Boolean).join("\n\n");
    },
    targetsForTool,
    turnTargets,
    controlPlane: makeEvolutionControlPlane(
      makeBearerEvolutionAuthorityResolver(
        runtime.controlToken,
        runtime.operatorPrincipalId,
        runtime.operatorCapabilities,
        currentSnapshotId,
      ),
      executor,
    ),
    agentTools: makeEvolutionAgentOperations(
      agentBackend(executor, currentSnapshotId, runtime.agentCapabilities),
    ).tools,
    ...(continuousService !== undefined && { continuousService }),
  };
};
