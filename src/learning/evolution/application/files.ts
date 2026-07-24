/* eslint-disable max-lines, max-lines-per-function, max-statements, complexity, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { hashBytes } from "../../../core/digest";
import type {
  RuntimeEvolutionTargetIdentity,
  ToolDefinition,
} from "../../../runtime/types";
import { buildEvolutionDataset } from "../datasets/builder";
import {
  EvolutionContainmentError,
  EvolutionDatasetError,
  EvolutionDecodeError,
  EvolutionNotFoundError,
} from "../errors";
import {
  EvolutionDatasetIdSchema,
  EvolutionRiskClassSchema,
  EvolutionTarget,
  EvolutionTargetClassSchema,
} from "../model/index";
import { validateInitialDatasetVolume } from "../targets/datasets";
import type { EvolutionWorkflowError } from "../types";
import { materializeFileEvolutionCodeSandbox } from "./code-sandbox";
import {
  makeDeterministicEvolutionSyntheticGenerator,
  makeRuntimeToolDatasetEntries,
  resolveEvolutionDatasetSource,
} from "./dataset-sources";
import type {
  EvolutionActiveTargetReader,
  EvolutionDatasetFactoryShape,
  EvolutionTargetCatalogShape,
  EvolutionTargetMaterialization,
} from "./types";

class FileEvolutionCodeSandboxDefinition
  extends Schema.Class<FileEvolutionCodeSandboxDefinition>(
    "FileEvolutionCodeSandboxDefinition",
  )({
    checkoutPaths: Schema.Array(Schema.String),
    targetFiles: Schema.Array(Schema.String),
    testCommands: Schema.Array(Schema.Array(Schema.String)),
    cpuQuota: Schema.Number,
    memoryMb: Schema.Int,
    pids: Schema.Int,
    timeoutMilliseconds: Schema.Int,
  })
{}

class FileEvolutionTargetDefinition
  extends Schema.Class<FileEvolutionTargetDefinition>(
    "FileEvolutionTargetDefinition",
  )({
    componentRef: Schema.String,
    targetClass: EvolutionTargetClassSchema,
    riskClass: EvolutionRiskClassSchema,
    baselinePath: Schema.String,
    mutationPath: Schema.optionalKey(Schema.String),
    runtimeToolName: Schema.optionalKey(Schema.String),
    runtimeToolNames: Schema.optionalKey(Schema.Array(Schema.String)),
    defaultSources: Schema.optionalKey(Schema.Array(Schema.String)),
    codeSandbox: Schema.optionalKey(FileEvolutionCodeSandboxDefinition),
    allowedMutationPaths: Schema.Array(Schema.String),
    frozenPaths: Schema.Array(Schema.String),
  })
{}

const FileEvolutionTargetDocument = Schema.Struct({
  targets: Schema.Array(FileEvolutionTargetDefinition),
});

const sortedTools = (
  tools: readonly ToolDefinition[],
): readonly ToolDefinition[] =>
  [...tools].toSorted((left, right) => left.name.localeCompare(right.name));

const toolsForDefinition = (
  definition: FileEvolutionTargetDefinition,
  tools: readonly ToolDefinition[],
): readonly ToolDefinition[] => {
  if (definition.runtimeToolNames?.includes("*") === true) {
    return sortedTools(tools);
  }
  const names = definition.runtimeToolNames
    ?? (definition.runtimeToolName === undefined
      ? []
      : [definition.runtimeToolName]);
  return names.flatMap((name) => {
    const tool = tools.find((candidate) => candidate.name === name);
    return tool === undefined ? [] : [tool];
  });
};

const canonicalToolCatalog = (
  tools: readonly ToolDefinition[],
): string =>
  `${
    JSON.stringify(
      Object.fromEntries(
        sortedTools(tools).map((tool) => [tool.name, tool.description]),
      ),
      undefined,
      2,
    )
  }\n`;

const stringCatalog = (
  content: string,
): Readonly<Record<string, string>> | undefined => {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const entries = Object.entries(value);
    return entries.every(([, item]) => typeof item === "string")
      ? Object.fromEntries(entries)
      : undefined;
  } catch {
    return undefined;
  }
};

const sameKeys = (
  catalog: Readonly<Record<string, string>>,
  tools: readonly ToolDefinition[],
): boolean =>
  JSON.stringify(
    Object.keys(catalog).toSorted((left, right) => left.localeCompare(right)),
  ) === JSON.stringify(
    tools.map((tool) => tool.name).toSorted((left, right) =>
      left.localeCompare(right)
    ),
  );

const configuredRuntimeToolCount = (
  definition: FileEvolutionTargetDefinition,
  tools: readonly ToolDefinition[],
): number => {
  if (definition.runtimeToolNames?.includes("*") === true) return tools.length;
  if (definition.runtimeToolNames !== undefined) {
    return definition.runtimeToolNames.length;
  }
  return definition.runtimeToolName === undefined ? 0 : 1;
};

export const containedPath = (
  root: string,
  requested: string,
): Effect.Effect<string, EvolutionContainmentError> => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, requested);
  if (
    resolved !== resolvedRoot
    && !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return EvolutionContainmentError.make({
      root: resolvedRoot,
      requestedPath: requested,
    });
  }
  return Effect.tryPromise({
    try: async () => {
      const [canonicalRoot, canonicalRequested] = await Promise.all([
        realpath(resolvedRoot),
        realpath(resolved),
      ]);
      if (
        canonicalRequested !== canonicalRoot
        && !canonicalRequested.startsWith(`${canonicalRoot}${path.sep}`)
      ) throw new Error("resolved path escapes the repository");
      return canonicalRequested;
    },
    catch: () =>
      EvolutionContainmentError.make({
        root: resolvedRoot,
        requestedPath: requested,
      }),
  });
};

const loadTargetDefinitions = (
  root: string,
  definitionFile: string,
) =>
  containedPath(root, definitionFile).pipe(
    Effect.flatMap((containedDefinitionFile) =>
      Effect.tryPromise({
        try: async (): Promise<unknown> =>
          parse(await readFile(containedDefinitionFile, "utf8")) as unknown,
        catch: (cause) =>
          EvolutionDecodeError.make({
            artifact: containedDefinitionFile,
            cause,
          }),
      })
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(FileEvolutionTargetDocument)),
    Effect.mapError((cause) =>
      cause instanceof EvolutionDecodeError
        ? cause
        : EvolutionDecodeError.make({
          artifact: definitionFile,
          cause,
        })
    ),
    Effect.flatMap((document) =>
      Effect.forEach(document.targets, (definition) =>
        containedPath(root, definition.baselinePath).pipe(
          Effect.map((baselinePath) => ({ definition, baselinePath })),
        ))
    ),
  );

export const makeFileEvolutionTargetCatalog = (
  root: string,
  definitionFile = path.join(root, ".elliott/evolution-targets.yaml"),
  active?: EvolutionActiveTargetReader,
  tools: readonly ToolDefinition[] = [],
): EvolutionTargetCatalogShape => {
  const resolve = Effect.fn("resolveFileEvolutionTarget")(function*(
    targetRef: string,
  ) {
    const definitions = yield* loadTargetDefinitions(root, definitionFile);
    const entry = definitions.find(
      ({ definition }) => definition.componentRef === targetRef,
    );
    if (entry === undefined) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-target",
        id: targetRef,
      });
    }
    const fileContent = yield* Effect.tryPromise({
      try: () => readFile(entry.baselinePath, "utf8"),
      catch: (cause) =>
        EvolutionDecodeError.make({
          artifact: entry.baselinePath,
          cause,
        }),
    });
    const runtimeTools = toolsForDefinition(entry.definition, tools);
    const configuredToolCount = configuredRuntimeToolCount(
      entry.definition,
      tools,
    );
    if (
      entry.definition.targetClass === "tool-description"
      && (
        runtimeTools.length === 0
        || runtimeTools.length !== configuredToolCount
      )
    ) {
      return yield* EvolutionNotFoundError.make({
        artifact: "runtime-tool-description",
        id: entry.definition.runtimeToolName
          ?? entry.definition.runtimeToolNames?.join(",")
          ?? targetRef,
      });
    }
    const activated = active?.contentForTarget(targetRef);
    if (
      entry.definition.targetClass === "tool-description"
      && entry.definition.runtimeToolNames !== undefined
      && activated !== undefined
    ) {
      const catalog = stringCatalog(activated.content);
      if (catalog === undefined || !sameKeys(catalog, runtimeTools)) {
        return yield* EvolutionDecodeError.make({
          artifact: `active-tool-catalog:${targetRef}`,
          cause:
            "active tool catalog must preserve every live runtime tool key",
        });
      }
    }
    const codeMaterialization = entry.definition.codeSandbox === undefined
      ? undefined
      : yield* materializeFileEvolutionCodeSandbox({
        componentRef: targetRef,
        ...entry.definition.codeSandbox,
        ...(activated !== undefined && { activeContent: activated.content }),
        resolveFile: (requested) => containedPath(root, requested),
      });
    if (
      entry.definition.targetClass === "code"
      && codeMaterialization === undefined
    ) {
      return yield* EvolutionDecodeError.make({
        artifact: `code-target:${targetRef}`,
        cause: "code targets require a codeSandbox definition",
      });
    }
    const sourceContent = entry.definition.runtimeToolNames === undefined
      ? runtimeTools[0]?.description ?? fileContent
      : canonicalToolCatalog(runtimeTools);
    const baselineContent = codeMaterialization?.baselineContent
      ?? activated?.content
      ?? sourceContent;
    const target = EvolutionTarget.make({
      targetClass: entry.definition.targetClass,
      componentRef: entry.definition.componentRef,
      baselineDigest: activated?.digest ?? hashBytes(baselineContent),
      riskClass: entry.definition.riskClass,
      mutationPath: entry.definition.mutationPath
        ?? entry.definition.baselinePath,
      allowedMutationPaths: entry.definition.allowedMutationPaths,
      frozenPaths: entry.definition.frozenPaths,
    });
    return {
      target,
      baselineContent,
      ...(codeMaterialization !== undefined && {
        codeSandbox: codeMaterialization.codeSandbox,
      }),
    } satisfies EvolutionTargetMaterialization;
  });
  return {
    resolve,
    activeDigest: (targetRef) =>
      resolve(targetRef).pipe(
        Effect.map(({ target }) => target.baselineDigest),
      ),
  };
};

export const listFileEvolutionTargetRefs = (
  root: string,
  definitionFile = path.join(root, ".elliott/evolution-targets.yaml"),
): Effect.Effect<readonly string[], EvolutionWorkflowError> =>
  loadTargetDefinitions(root, definitionFile).pipe(
    Effect.map((entries) =>
      entries.map(({ definition }) => definition.componentRef)
    ),
  );

export const makeActiveEvolutionToolDecorator = async (
  root: string,
  active: EvolutionActiveTargetReader,
): Promise<
  (tools: readonly ToolDefinition[]) => readonly ToolDefinition[]
> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  const targetByToolName = new Map(
    document.flatMap(({ definition }) =>
      definition.targetClass !== "tool-description"
        || definition.runtimeToolName === undefined
        ? []
        : [[definition.runtimeToolName, definition.componentRef] as const]
    ),
  );
  const catalogDefinitions = document
    .map(({ definition }) => definition)
    .filter((definition) =>
      definition.targetClass === "tool-description"
      && definition.runtimeToolNames !== undefined
    );
  return (tools) =>
    tools.map((tool) => {
      const catalogTargets = catalogDefinitions.filter((definition) =>
        toolsForDefinition(definition, tools).some((candidate) =>
          candidate.name === tool.name
        )
      );
      const targetRefs = [
        ...(targetByToolName.has(tool.name)
          ? [targetByToolName.get(tool.name)!]
          : []),
        ...catalogTargets.map((definition) => definition.componentRef),
      ];
      if (targetRefs.length > 1) {
        throw new Error(
          `tool ${tool.name} belongs to multiple evolution description targets`,
        );
      }
      const targetRef = targetRefs[0];
      if (targetRef === undefined) return tool;
      const catalog = catalogTargets.length === 1;
      const originalDescription = tool.description;
      return {
        ...tool,
        get description() {
          const activated = active.contentForTarget(targetRef);
          if (activated === undefined) return originalDescription;
          if (!catalog) return activated.content;
          const descriptions = stringCatalog(activated.content);
          const description = descriptions?.[tool.name];
          if (description === undefined) {
            throw new Error(
              `active tool catalog ${targetRef} is missing ${tool.name}`,
            );
          }
          return description;
        },
      };
    });
};

export const makeEvolutionRuntimeToolTargetResolver = async (
  root: string,
  active: EvolutionActiveTargetReader,
  tools: readonly ToolDefinition[],
): Promise<
  (toolName: string) => readonly RuntimeEvolutionTargetIdentity[]
> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  const targetByToolName = new Map<string, {
    readonly targetRef: string;
    readonly baselineDigest: string;
  }[]>();
  for (const { definition, baselinePath } of document) {
    const runtimeTools = toolsForDefinition(definition, tools);
    if (
      definition.targetClass === "tool-description"
      && definition.runtimeToolNames !== undefined
    ) {
      const baselineDigest = hashBytes(canonicalToolCatalog(runtimeTools));
      for (const runtimeTool of runtimeTools) {
        const values = targetByToolName.get(runtimeTool.name) ?? [];
        values.push({
          targetRef: definition.componentRef,
          baselineDigest,
        });
        targetByToolName.set(runtimeTool.name, values);
      }
      continue;
    }
    if (definition.runtimeToolName === undefined) continue;
    const baselineContent = definition.targetClass === "tool-description"
      ? runtimeTools[0]?.description ?? ""
      : await readFile(baselinePath, "utf8");
    const values = targetByToolName.get(definition.runtimeToolName) ?? [];
    values.push({
      targetRef: definition.componentRef,
      baselineDigest: hashBytes(baselineContent),
    });
    targetByToolName.set(definition.runtimeToolName, values);
  }
  return (toolName) =>
    (targetByToolName.get(toolName) ?? []).map((target) => ({
      targetRef: target.targetRef,
      digest: active.contentForTarget(target.targetRef)?.digest
        ?? target.baselineDigest,
    }));
};

export const makeEvolutionRuntimeTurnTargetResolver = async (
  root: string,
  active: EvolutionActiveTargetReader,
): Promise<() => readonly RuntimeEvolutionTargetIdentity[]> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  const targets = await Promise.all(
    document.filter(({ definition }) =>
      definition.targetClass === "skill"
      || definition.targetClass === "prompt-segment"
    ).map(async ({ definition, baselinePath }) => ({
      targetRef: definition.componentRef,
      baselineDigest: hashBytes(await readFile(baselinePath, "utf8")),
    })),
  );
  return () =>
    targets.map((target) => ({
      targetRef: target.targetRef,
      digest: active.contentForTarget(target.targetRef)?.digest
        ?? target.baselineDigest,
    }));
};

export const makeActiveEvolutionPromptDecorator = async (
  root: string,
  active: EvolutionActiveTargetReader,
): Promise<
  (
    baselinePath: string,
    baselineContent: string,
  ) => () => string
> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  const promptsByPath = new Map(
    document.flatMap(({ definition, baselinePath }) =>
      definition.targetClass === "prompt-segment"
        ? [[baselinePath, definition.componentRef] as const]
        : []
    ),
  );
  return (baselinePath, baselineContent) => {
    const targetRef = promptsByPath.get(path.resolve(baselinePath));
    return () =>
      targetRef === undefined
        ? baselineContent
        : active.contentForTarget(targetRef)?.content ?? baselineContent;
  };
};

export const makeActiveEvolutionSkillDecorator = async (
  root: string,
  active: EvolutionActiveTargetReader,
): Promise<() => string> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  const skills = await Promise.all(
    document.flatMap(({ definition, baselinePath }) =>
      definition.targetClass === "skill"
        ? [{ definition, baselinePath }]
        : []
    ).map(async ({ definition, baselinePath }) => ({
      targetRef: definition.componentRef,
      baselineContent: await readFile(baselinePath, "utf8"),
    })),
  );
  return () =>
    skills.length === 0
      ? ""
      : [
        "## Available zero-authority procedures",
        "Apply a procedure only when the current task matches its declared purpose.",
        ...skills.map((skill) =>
          active.contentForTarget(skill.targetRef)?.content
            ?? skill.baselineContent
        ),
      ].join("\n\n");
};

export const loadFileEvolutionDefaultSources = async (
  root: string,
): Promise<Readonly<Record<string, readonly string[]>>> => {
  const document = await Effect.runPromise(loadTargetDefinitions(
    root,
    path.join(root, ".elliott/evolution-targets.yaml"),
  ));
  return Object.fromEntries(
    document.flatMap(({ definition }) =>
      definition.defaultSources === undefined
        ? []
        : [[definition.componentRef, definition.defaultSources] as const]
    ),
  );
};

export const makeFileEvolutionDatasetFactory = (
  root: string,
  split: {
    readonly train: number;
    readonly validation: number;
    readonly holdout: number;
  },
  options: {
    readonly sessionDatabase?: string;
    readonly defaultSources?: Readonly<
      Record<string, readonly string[]>
    >;
    readonly runtimeTools?: readonly ToolDefinition[];
  } = {},
): EvolutionDatasetFactoryShape => ({
  // Source decoding, volume validation, splitting, and sealing intentionally
  // remain one Effect transaction so a partial dataset is never persisted.

  build: Effect.fn("buildFileEvolutionDataset")(function*(
    target,
    sources,
    seed,
  ) {
    const sourceFiles = sources.length === 0
      ? [...(options.defaultSources?.[target.componentRef] ?? ["synthetic"])]
      : [...sources];
    const syntheticGenerator = makeDeterministicEvolutionSyntheticGenerator(
      makeRuntimeToolDatasetEntries(options.runtimeTools ?? []),
    );
    const resolvedSources = yield* Effect.forEach(
      sourceFiles,
      (sourceFile) =>
        resolveEvolutionDatasetSource({
          target,
          source: sourceFile,
          resolveFile: (requested) =>
            containedPath(root, requested).pipe(
              Effect.mapError((cause) =>
                EvolutionDatasetError.make({
                  operation: "resolve-dataset-source",
                  reason: String(cause),
                  caseIds: [],
                })
              ),
            ),
          syntheticGenerator,
          ...(options.sessionDatabase !== undefined && {
            sessionDatabase: options.sessionDatabase,
          }),
        }),
      { concurrency: 1 },
    );
    const cases = resolvedSources.flatMap((source) => source.cases);
    yield* validateInitialDatasetVolume(target.targetClass, cases);
    if (cases.length === 0) {
      return yield* EvolutionDatasetError.make({
        operation: "build-file-dataset",
        reason: "at least one curated case is required",
        caseIds: [],
      });
    }
    return yield* buildEvolutionDataset({
      id: EvolutionDatasetIdSchema.make(`evd_${crypto.randomUUID()}`),
      targetDigest: target.baselineDigest,
      splitSeed: seed,
      split,
      sources: resolvedSources.map((source) => source.source),
      cases,
      createdAt: new Date().toISOString(),
    });
  }),
});
