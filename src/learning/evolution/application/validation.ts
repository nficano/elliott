/* eslint-disable max-lines, max-lines-per-function, complexity, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import { hashBytes } from "../../../core/digest";
import type { PromptSegment } from "../../../prompt/types";
import { validateMutationPaths } from "../constraints/common";
import {
  EvolutionCandidate,
  type EvolutionCodeSandboxContract,
  EvolutionConstraintResult,
} from "../model/index";
import type { EvolutionCandidateValidatorShape } from "../orchestrator/types";
import type { EvolutionTrustedCodeCheckerShape } from "../orchestrator/types";
import {
  validatePromptCandidate,
  validateSkillCandidate,
  validateToolDescriptionCandidate,
} from "../targets/index";
import type { EvolutionWorkflowError } from "../types";

const FRONTMATTER_BODY_OFFSET = 4;
const FRONTMATTER_END_LENGTH = 5;
const MAXIMUM_CANDIDATE_EXPANSION_RATIO = 1.2;
const MAXIMUM_TOOL_DESCRIPTION_CHARACTERS = 500;
const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;
const CODE_UNSAFE_PATTERNS = [
  /\bas\s+any\b/gu,
  /@ts-ignore/gu,
  /eslint-disable/gu,
  /child_process/gu,
  /docker\.sock/gu,
  /\bas\s+unknown\s+as\b/gu,
];
const CODE_UNBOUNDED_LOOP_PATTERNS = [
  /\bwhile\s*\(\s*true\s*\)/gu,
  /\bfor\s*\(\s*;\s*;\s*\)/gu,
];
const CODE_SECURITY_MARKERS = [
  /\bauthoriz\w*/gu,
  /\bvalidat\w*/gu,
  /\bsanitiz\w*/gu,
  /\bstrip\w*/gu,
  /\bcapabilit\w*/gu,
  /\begress\w*/gu,
  /\bthrow\s+new\b/gu,
  /\bcatch\b/gu,
];
// The expression is bounded to one declaration prefix and identifier.
/* eslint-disable security/detect-unsafe-regex */
const CODE_EXPORT_PATTERN =
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/gu;
/* eslint-enable security/detect-unsafe-regex */
const CODE_NETWORK_DESTINATION_PATTERN =
  /https?:\/\/([A-Za-z0-9.-]+)(?=[:/"'])/gu;

const frontmatter = (content: string): string => {
  if (!content.startsWith("---\n")) return "";
  const end = content.indexOf("\n---\n", FRONTMATTER_BODY_OFFSET);
  return end === -1
    ? content
    : content.slice(0, end + FRONTMATTER_END_LENGTH);
};

const changedPatchPaths = (patch: string): readonly string[] =>
  patch.split(/\r?\n/u)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice("+++ b/".length));

const replacementPatch = (
  path: string,
  baseline: string,
  candidate: string,
): string => {
  const baselineLines = baseline.split(/\r?\n/u);
  const candidateLines = candidate.split(/\r?\n/u);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${baselineLines.length} +1,${candidateLines.length} @@`,
    ...baselineLines.map((line) => `-${line}`),
    ...candidateLines.map((line) => `+${line}`),
    "",
  ].join("\n");
};

const renderCandidate = (
  run: Parameters<EvolutionCandidateValidatorShape["validate"]>[0],
  candidate: EvolutionCandidate,
  baselineContent: string,
): EvolutionCandidate => {
  if (
    run.target.targetClass !== "skill"
    || candidate.materializedContent === undefined
  ) return candidate;
  const prefix = frontmatter(baselineContent);
  const candidatePrefix = frontmatter(candidate.materializedContent);
  const body = candidate.materializedContent.slice(candidatePrefix.length);
  const materializedContent = `${prefix}${body}`;
  const mutationPath = run.target.mutationPath
    ?? run.target.allowedMutationPaths[0]
    ?? "SKILL.md";
  return EvolutionCandidate.make({
    ...candidate,
    candidateDigest: hashBytes(materializedContent),
    materializedContent,
    patch: replacementPatch(
      mutationPath,
      baselineContent,
      materializedContent,
    ),
  });
};

const constraint = (
  name: string,
  passed: boolean,
  detail: string,
): EvolutionConstraintResult =>
  EvolutionConstraintResult.make({
    constraint: name,
    passed,
    detail,
    evidenceDigests: [],
  });

const skillNamespace = (componentRef: string): string => {
  const marker = "/skill/";
  const boundary = componentRef.indexOf(marker);
  return boundary === -1 ? componentRef : componentRef.slice(0, boundary);
};

const stringRecord = (
  value: unknown,
): Readonly<Record<string, string>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) return undefined;
  return Object.fromEntries(
    entries.flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : []
    ),
  );
};

const toolDescriptions = (
  content: string,
  mutationPath: string | undefined,
): Readonly<Record<string, string>> | undefined => {
  if (mutationPath?.endsWith(".json") !== true) return { tool: content };
  try {
    return stringRecord(JSON.parse(content));
  } catch {
    return undefined;
  }
};

const approximateTokens = (content: string): number =>
  Math.max(1, Math.ceil(content.length / APPROXIMATE_CHARACTERS_PER_TOKEN));

const promptSegment = (
  run: Parameters<EvolutionCandidateValidatorShape["validate"]>[0],
  content: string,
): PromptSegment => ({
  id: run.target.componentRef,
  purpose: "interaction-profile",
  source: run.target.mutationPath ?? run.target.componentRef,
  digest: hashBytes(content),
  trust: "authenticated",
  securityTags: [],
  classification: "internal",
  content,
  evolution: {
    id: run.target.componentRef,
    targetClass: "prompt-segment",
    evolvable: true,
    authority: "zero",
    maximumTokenRatio: MAXIMUM_CANDIDATE_EXPANSION_RATIO,
  },
});

const targetAdapterConstraints = (
  run: Parameters<EvolutionCandidateValidatorShape["validate"]>[0],
  baseline: string,
  candidate: string,
): readonly EvolutionConstraintResult[] => {
  try {
    if (run.target.targetClass === "skill") {
      return validateSkillCandidate({
        target: run.target,
        namespace: skillNamespace(run.target.componentRef),
        baselineMarkdown: baseline,
        candidateMarkdown: candidate,
        maximumCharacters: Math.ceil(
          baseline.length * MAXIMUM_CANDIDATE_EXPANSION_RATIO,
        ),
      }).results;
    }
    if (run.target.targetClass === "tool-description") {
      const baselineDescriptions = toolDescriptions(
        baseline,
        run.target.mutationPath,
      );
      const candidateDescriptions = toolDescriptions(
        candidate,
        run.target.mutationPath,
      );
      if (
        baselineDescriptions === undefined
        || candidateDescriptions === undefined
      ) {
        return [
          constraint(
            "tool-description-document",
            false,
            "tool-description catalog candidates must be string-valued JSON objects",
          ),
        ];
      }
      const topLevelDescriptionKey = Object.keys(baselineDescriptions)[0]
        ?? "tool";
      return validateToolDescriptionCandidate({
        target: run.target,
        baselineDescriptions,
        candidateDescriptions,
        baselineSchema: {},
        candidateSchema: {},
        topLevelDescriptionKey,
        maximumTopLevelCharacters: MAXIMUM_TOOL_DESCRIPTION_CHARACTERS,
        maximumParameterCharacters: MAXIMUM_TOOL_DESCRIPTION_CHARACTERS,
      }).results;
    }
    if (run.target.targetClass === "prompt-segment") {
      return validatePromptCandidate({
        target: run.target,
        baseline: promptSegment(run, baseline),
        candidate: promptSegment(run, candidate),
        baselineTokenCount: approximateTokens(baseline),
        candidateTokenCount: approximateTokens(candidate),
      }).results;
    }
    return [];
  } catch {
    return [
      constraint(
        "target-adapter-schema",
        false,
        "candidate could not be decoded by its target adapter",
      ),
    ];
  }
};

const requiredEngineConstraint = (
  candidate: EvolutionCandidate,
  name: string,
): EvolutionConstraintResult =>
  candidate.constraints.find((item) => item.constraint === name)
    ?? constraint(name, false, "required engine evidence is absent");

const promptAuthorityPreserved = (content: string): boolean => {
  const normalized = content.toLowerCase().replaceAll(/\s+/gu, " ");
  return !normalized.includes("grant capability")
    && !normalized.includes("ignore security")
    && !normalized.includes("override system")
    && !normalized.includes("reveal secret")
    && !normalized.includes("higher priority than");
};

const matches = (content: string, pattern: RegExp): readonly string[] =>
  [...content.matchAll(pattern)].map((match) => match[1] ?? match[0]);

const noNewMatches = (
  baseline: string,
  candidate: string,
  patterns: readonly RegExp[],
): boolean =>
  patterns.every((pattern) =>
    matches(candidate, pattern).length <= matches(baseline, pattern).length
  );

const codeStaticConstraints = (
  baseline: string,
  candidate: string,
): readonly EvolutionConstraintResult[] => {
  const staticSafety = noNewMatches(
    baseline,
    candidate,
    CODE_UNSAFE_PATTERNS,
  ) && noNewMatches(baseline, candidate, CODE_UNBOUNDED_LOOP_PATTERNS);
  const securityMarkers = CODE_SECURITY_MARKERS.every((pattern) =>
    matches(candidate, pattern).length >= matches(baseline, pattern).length
  );
  const baselineExports = new Set(matches(baseline, CODE_EXPORT_PATTERN));
  const candidateExports = new Set(matches(candidate, CODE_EXPORT_PATTERN));
  const exportsPreserved = [...baselineExports].every((name) =>
    candidateExports.has(name)
  );
  const baselineDestinations = new Set(
    matches(baseline, CODE_NETWORK_DESTINATION_PATTERN),
  );
  const candidateDestinations = new Set(
    matches(candidate, CODE_NETWORK_DESTINATION_PATTERN),
  );
  const destinationsPreserved = [...candidateDestinations].every((host) =>
    baselineDestinations.has(host)
  );
  return [
    constraint(
      "code-static-safety",
      staticSafety,
      staticSafety
        ? "no unsafe cast, suppression, ambient process access, or unbounded loop was introduced"
        : "candidate introduced a forbidden unsafe construct",
    ),
    constraint(
      "code-security-markers",
      securityMarkers,
      securityMarkers
        ? "security and error-handling markers are preserved"
        : "candidate removed a security or error-handling marker",
    ),
    constraint(
      "code-public-exports",
      exportsPreserved,
      exportsPreserved
        ? "baseline public exports remain present"
        : "candidate removed a baseline public export",
    ),
    constraint(
      "code-network-destinations",
      destinationsPreserved,
      destinationsPreserved
        ? "candidate introduces no network destination"
        : "candidate introduces a new network destination",
    ),
  ];
};

const targetSpecificConstraints = (
  run: Parameters<EvolutionCandidateValidatorShape["validate"]>[0],
  candidate: EvolutionCandidate,
  baselineContent: string,
  codeSandbox: EvolutionCodeSandboxContract | undefined,
  checker: EvolutionTrustedCodeCheckerShape | undefined,
): Effect.Effect<
  readonly EvolutionConstraintResult[],
  EvolutionWorkflowError
> => {
  if (run.target.targetClass === "code") {
    return checker !== undefined && codeSandbox !== undefined
      ? checker.check(run, candidate, codeSandbox)
      : Effect.succeed([
        requiredEngineConstraint(candidate, "code-focused-test"),
        requiredEngineConstraint(candidate, "code-full-check"),
        requiredEngineConstraint(candidate, "code-frozen-surface"),
      ]);
  }
  if (run.target.targetClass === "prompt-segment") {
    const authorityPreserved = promptAuthorityPreserved(
      candidate.materializedContent ?? "",
    );
    return Effect.succeed([
      ...targetAdapterConstraints(
        run,
        baselineContent,
        candidate.materializedContent ?? "",
      ),
      constraint(
        "prompt-authority-static",
        authorityPreserved,
        authorityPreserved
          ? "frozen typed metadata preserves trust order and no authority claim was introduced"
          : "candidate introduces an authority or instruction-precedence claim",
      ),
      constraint(
        "prompt-source",
        true,
        "the typed source ID and cache boundary are outside the mutation surface",
      ),
    ]);
  }
  return Effect.succeed(targetAdapterConstraints(
    run,
    baselineContent,
    candidate.materializedContent ?? "",
  ));
};

export const makeFileEvolutionCandidateValidator = (
  checker?: EvolutionTrustedCodeCheckerShape,
): EvolutionCandidateValidatorShape => ({
  validate: (run, candidate, baselineContent, codeSandbox) =>
    Effect.gen(function*() {
      const sourceContent = candidate.materializedContent;
      const engineDigestMatches = sourceContent !== undefined
        && sourceContent.length > 0
        && candidate.candidateDigest === hashBytes(sourceContent);
      const renderedCandidate = engineDigestMatches
        ? renderCandidate(run, candidate, baselineContent)
        : candidate;
      const content = renderedCandidate.materializedContent;
      const materialized = content ?? "";
      const digestMatches = engineDigestMatches
        && content !== undefined
        && renderedCandidate.candidateDigest === hashBytes(materialized);
      const baselineMatches = run.target.baselineDigest
        === hashBytes(baselineContent);
      const frontmatterMatches = frontmatter(baselineContent)
        === frontmatter(materialized);
      const footprintPassed = materialized.length
        <= Math.max(1, baselineContent.length)
          * MAXIMUM_CANDIDATE_EXPANSION_RATIO;
      const common = [
        ...validateMutationPaths({
          target: run.target,
          changedPaths: changedPatchPaths(renderedCandidate.patch),
        }),
        constraint(
          "candidate-content-digest",
          digestMatches,
          digestMatches
            ? "materialized candidate bytes match the candidate digest"
            : "materialized candidate bytes are absent or mismatched",
        ),
        constraint(
          "baseline-content-digest",
          baselineMatches,
          baselineMatches
            ? "baseline bytes match the scoped target"
            : "baseline bytes changed after scoping",
        ),
        constraint(
          "authority-frontmatter",
          frontmatterMatches,
          frontmatterMatches
            ? "authority-bearing frontmatter is byte-stable"
            : "candidate changed authority-bearing frontmatter",
        ),
        constraint(
          "candidate-footprint",
          footprintPassed,
          `${materialized.length}/${baselineContent.length} characters`,
        ),
      ];
      const specific = yield* targetSpecificConstraints(
        run,
        renderedCandidate,
        baselineContent,
        codeSandbox,
        checker,
      );
      return EvolutionCandidate.make({
        ...renderedCandidate,
        constraints: [
          ...common,
          ...(run.target.targetClass === "code"
            ? codeStaticConstraints(baselineContent, materialized)
            : []),
          ...specific,
        ],
      });
    }),
});
