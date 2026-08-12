import { loadAgentSkill } from "../../../manifest/agentskills";
import { constraintResult, validation } from "../constraints/common";
import type {
  EvolutionSkillCandidateInput,
  EvolutionTargetValidation,
} from "./types";

const FRONTMATTER_START = "---\n";
const FRONTMATTER_END = "\n---\n";

const frontmatterBytes = (markdown: string): string => {
  if (!markdown.startsWith(FRONTMATTER_START)) return "";
  const end = markdown.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  return end === -1
    ? markdown
    : markdown.slice(0, end + FRONTMATTER_END.length);
};

const hasInjectionPattern = (input: string): boolean => {
  const normalized = input.toLowerCase().replaceAll(/\s+/g, " ");
  return normalized.includes("ignore previous instructions")
    || normalized.includes("ignore all previous instructions")
    || normalized.includes("ignore prior instructions")
    || normalized.includes("system prompt");
};

const skillIdentityResults = (
  input: EvolutionSkillCandidateInput,
  baseline: ReturnType<typeof loadAgentSkill>,
  candidate: ReturnType<typeof loadAgentSkill>,
) => {
  const identityPreserved = baseline.ref === candidate.ref
    && baseline.name === candidate.name;
  const frontmatterPreserved = frontmatterBytes(input.baselineMarkdown)
    === frontmatterBytes(input.candidateMarkdown);
  const authorityPreserved = JSON.stringify(baseline.allowedTools)
      === JSON.stringify(candidate.allowedTools)
    && JSON.stringify(baseline.requestedCapabilities)
      === JSON.stringify(candidate.requestedCapabilities)
    && input.baselineOverlayRaw === input.candidateOverlayRaw;
  const targetClassMatches = input.target.targetClass === "skill";
  return [
    constraintResult(
      "skill-target-class",
      targetClassMatches,
      targetClassMatches
        ? "target is bound to the skill adapter"
        : "non-skill target was sent to the skill adapter",
    ),
    constraintResult(
      "skill-identity",
      identityPreserved,
      identityPreserved ? "skill identity is frozen" : "skill identity changed",
    ),
    constraintResult(
      "skill-frontmatter",
      frontmatterPreserved,
      frontmatterPreserved
        ? "discovery and authority frontmatter is byte-stable"
        : "candidate changed frozen skill frontmatter",
    ),
    constraintResult(
      "skill-authority-overlay",
      authorityPreserved,
      authorityPreserved
        ? "allowed tools and capability overlay are byte-stable"
        : "candidate changed authority-bearing skill metadata",
    ),
  ];
};

const skillContentResults = (
  input: EvolutionSkillCandidateInput,
  candidate: ReturnType<typeof loadAgentSkill>,
) => {
  const footprintPassed = candidate.markdown.length <= input.maximumCharacters;
  const injectionPassed = !hasInjectionPattern(candidate.markdown);
  return [
    constraintResult(
      "skill-footprint",
      footprintPassed,
      `${candidate.markdown.length}/${input.maximumCharacters} characters`,
    ),
    constraintResult(
      "skill-injection-static",
      injectionPassed,
      injectionPassed
        ? "no direct instruction-precedence override detected"
        : "candidate contains an instruction-precedence override",
    ),
  ];
};

export const validateSkillCandidate = (
  input: EvolutionSkillCandidateInput,
): EvolutionTargetValidation => {
  const baseline = loadAgentSkill({
    namespace: input.namespace,
    markdown: input.baselineMarkdown,
    ...(input.baselineOverlayRaw !== undefined
      && { overlayRaw: input.baselineOverlayRaw }),
    trustedWorkspace: true,
  });
  const candidate = loadAgentSkill({
    namespace: input.namespace,
    markdown: input.candidateMarkdown,
    ...(input.candidateOverlayRaw !== undefined
      && { overlayRaw: input.candidateOverlayRaw }),
    trustedWorkspace: true,
  });
  return validation([
    ...skillIdentityResults(input, baseline, candidate),
    ...skillContentResults(input, candidate),
  ]);
};
