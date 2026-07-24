import type { EvolutionProposalAuthorInput } from "./types";

const metricLines = (input: EvolutionProposalAuthorInput): readonly string[] =>
  input.report.metrics.map((metric) =>
    `- ${metric.metric} (${metric.split}): baseline ${metric.baseline}, candidate ${metric.candidate}, delta ${metric.delta}, passed ${metric.passed}`
  );

const footprintLines = (
  input: EvolutionProposalAuthorInput,
): readonly string[] =>
  input.report.footprints.map((footprint) =>
    `- ${footprint.category}/${footprint.metric}: baseline ${footprint.baseline}, candidate ${footprint.candidate}, regression ratio ${footprint.regressionRatio}, passed ${footprint.passed}`
  );

const identityReview = (
  input: EvolutionProposalAuthorInput,
): readonly string[] => [
  `# Evolution Proposal: ${input.run.target.componentRef}`,
  "",
  "## 1. Permission and authority delta",
  "",
  `- Risk class: ${input.run.target.riskClass}`,
  `- Allowed mutation paths: ${
    input.run.target.allowedMutationPaths.join(", ")
  }`,
  `- Frozen paths: ${input.run.target.frozenPaths.join(", ")}`,
  "- Widened capabilities: none",
  "",
  "## 2. Target and candidate digests",
  "",
  `- Baseline target: ${input.run.target.baselineDigest}`,
  `- Candidate: ${input.candidate.candidateDigest}`,
  `- Baseline Snapshot: ${input.run.baselineSnapshotId}`,
  `- Candidate Snapshot: ${input.report.candidateSnapshotId}`,
  "",
  "## 3. Human-readable diff",
  "",
  "Review [patch.diff](./patch.diff) line by line.",
  "",
];

const resultReview = (
  input: EvolutionProposalAuthorInput,
): readonly string[] => [
  "## 4. Holdout effect and confidence",
  "",
  `- Method: ${input.report.comparison.method}`,
  `- Effect size: ${input.report.comparison.effectSize}`,
  `- Confidence interval: [${input.report.comparison.confidenceIntervalLow}, ${input.report.comparison.confidenceIntervalHigh}]`,
  `- Sample count: ${input.report.comparison.sampleCount}`,
  "",
  "## 5. Per-tool or per-category regressions",
  "",
  ...metricLines(input),
  "",
  "## 6. Full checks and broad benchmarks",
  "",
  `- Passing benchmark gates: ${
    input.report.benchmarks.filter((item) => item.passed).length
  }/${input.report.benchmarks.length}`,
  "- Detailed signed results: [benchmarks.yaml](./benchmarks.yaml)",
  "",
  "## 7. Prompt, inference, and runtime footprints",
  "",
  ...footprintLines(input),
  "",
];

const provenanceReview = (
  input: EvolutionProposalAuthorInput,
): readonly string[] => [
  "## 8. Optimization cost and rejected constraints",
  "",
  `- Candidate cost: ${input.candidate.usage.costUsd} USD`,
  `- Candidate tokens: ${
    input.candidate.usage.inputTokens + input.candidate.usage.outputTokens
  }`,
  `- Rejected constraints: ${
    input.candidate.constraints.filter((item) => !item.passed).length
  }`,
  "",
  "## 9. Engine, route, dataset, and lineage provenance",
  "",
  `- Engine: ${input.run.engineRef} (${input.run.engineKind})`,
  `- Engine trace: ${input.candidate.engineTraceDigest}`,
  `- Authoring route: ${input.report.authoringRouteDigest}`,
  `- Evaluation route: ${input.report.evaluationRouteDigest}`,
  `- Dataset: ${input.report.datasetDigest}`,
  `- Evaluation plan: ${input.report.evaluationPlanDigest}`,
  `- Parent candidate: ${input.candidate.parentCandidateId ?? "none"}`,
  "",
];

export const renderEvolutionProposalReview = (
  input: EvolutionProposalAuthorInput,
): string =>
  [
    ...identityReview(input),
    ...resultReview(input),
    ...provenanceReview(input),
  ].join("\n");
