import path from "node:path";
import {
  EvolutionCodeCheckReport,
  EvolutionCodeCheckRequest,
} from "../../../../src/learning/evolution/model/index";
import type {
  EvolutionCodeSandboxContract,
  EvolutionConstraintResult,
} from "../../../../src/learning/evolution/model/index";
import {
  canonicalJson,
  decodeUnknown,
  MAX_RESPONSE_BYTES,
  requireLoopbackEndpoint,
  sha256Text,
  wireError,
} from "../../../runtime/wire";

const REQUIRED_CONSTRAINTS = new Set([
  "code-focused-test",
  "code-full-check",
  "code-frozen-surface",
]);
const FORBIDDEN_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "curl",
  "dash",
  "docker",
  "doas",
  "env",
  "fish",
  "git",
  "kubectl",
  "nerdctl",
  "podman",
  "powershell",
  "pwsh",
  "sh",
  "sudo",
  "wget",
  "zsh",
]);
const EXECUTOR_FAILURE_STATUS = 500;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const safeRelativePath = (value: string): boolean =>
  value.length > 0
  && !value.includes("\0")
  && !path.posix.isAbsolute(value)
  && value !== "."
  && !value.split("/").includes("..");

const validateCheckoutFiles = (
  sandbox: EvolutionCodeSandboxContract,
): Set<string> => {
  const paths = new Set<string>();
  for (const file of sandbox.checkoutFiles) {
    if (
      !safeRelativePath(file.path)
      || paths.has(file.path)
      || file.digest !== sha256Text(file.content)
    ) {
      return wireError("checkout files are not uniquely sealed");
    }
    paths.add(file.path);
  }
  return paths;
};

const validateTestCommands = (
  sandbox: EvolutionCodeSandboxContract,
): void => {
  for (const command of sandbox.testCommands) {
    const executable = command[0];
    if (
      executable === undefined
      || command.some((item) => item.length === 0)
      || FORBIDDEN_EXECUTABLES.has(path.posix.basename(executable))
    ) {
      return wireError("code sandbox contains a forbidden test command");
    }
  }
};

const validateSandbox = (sandbox: EvolutionCodeSandboxContract): void => {
  if (
    !sandbox.checkoutRef.startsWith("candidate://")
    || sandbox.checkoutRef.includes("..")
    || sandbox.checkoutFiles.length === 0
    || sandbox.targetFiles.length === 0
    || sandbox.testCommands.length === 0
  ) {
    return wireError("code sandbox is incomplete");
  }
  const paths = validateCheckoutFiles(sandbox);
  if (sandbox.targetFiles.some((item) => !paths.has(item))) {
    return wireError("targetFiles must name files in the sealed checkout");
  }
  validateTestCommands(sandbox);
};

const bindingsMatch = (request: EvolutionCodeCheckRequest): boolean =>
  request.run.target.targetClass === "code"
  && request.candidate.runId === request.run.id
  && request.candidate.targetDigest === request.run.target.baselineDigest
  && request.candidate.materializedContent !== undefined
  && request.candidate.candidateDigest
    === sha256Text(request.candidate.materializedContent);

const targetFilesMatch = (
  files: Readonly<Record<string, unknown>>,
  targetFiles: readonly string[],
): boolean =>
  Object.keys(files).length === targetFiles.length
  && targetFiles.every((item) => typeof files[item] === "string")
  && Object.keys(files).every((item) => targetFiles.includes(item));

const validateRequest = (value: unknown): EvolutionCodeCheckRequest => {
  const request = decodeUnknown(
    EvolutionCodeCheckRequest,
    value,
    "code-check request",
  );
  if (!bindingsMatch(request)) {
    return wireError("candidate does not match the run or materialized digest");
  }
  const content = request.candidate.materializedContent;
  if (content === undefined) {
    return wireError("candidate does not match the run or materialized digest");
  }
  validateSandbox(request.codeSandbox);
  let materialized: unknown;
  try {
    materialized = JSON.parse(content);
  } catch {
    return wireError("candidate materializedContent is invalid");
  }
  const files = isRecord(materialized) ? materialized["files"] : undefined;
  if (
    !isRecord(files)
    || !targetFilesMatch(files, request.codeSandbox.targetFiles)
  ) {
    return wireError("candidate content must contain exactly the target files");
  }
  return request;
};

const fixtureReport = (
  request: EvolutionCodeCheckRequest,
): EvolutionCodeCheckReport =>
  EvolutionCodeCheckReport.make({
    runId: request.run.id,
    candidateId: request.candidate.id,
    candidateDigest: request.candidate.candidateDigest,
    constraints: [...REQUIRED_CONSTRAINTS]
      .toSorted((left, right) => left.localeCompare(right))
      .map((constraint) => ({
        constraint,
        passed: true,
        detail: "isolated fixture check passed",
        evidenceDigests: [sha256Text(`fixture:${constraint}`)],
      })),
  });

const execute = async (
  request: EvolutionCodeCheckRequest,
): Promise<unknown> => {
  const executor = requireLoopbackEndpoint(
    Bun.env["ELLIOTT_CODE_CHECK_EXECUTOR_ENDPOINT"],
    Bun.env["ELLIOTT_CODE_CHECK_EXECUTOR_TOKEN"],
    "code-check executor",
  );
  const response = await fetch(
    new URL("/v1/candidate/check", executor.endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${executor.token}`,
        "content-type": "application/json",
      },
      body: canonicalJson(request),
      signal: AbortSignal.timeout(request.codeSandbox.timeoutMilliseconds),
    },
  );
  if (!response.ok) {
    return wireError(
      `code-check executor returned HTTP ${response.status}`,
      EXECUTOR_FAILURE_STATUS,
    );
  }
  const encoded = await response.text();
  if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
    return wireError(
      "code-check executor result exceeds the size limit",
      EXECUTOR_FAILURE_STATUS,
    );
  }
  try {
    return JSON.parse(encoded);
  } catch {
    return wireError(
      "code-check executor returned invalid JSON",
      EXECUTOR_FAILURE_STATUS,
    );
  }
};

const validateConstraintNames = (
  constraints: readonly EvolutionConstraintResult[],
): void => {
  const names = new Set(constraints.map((item) => item.constraint));
  if (
    names.size !== constraints.length
    || names.size !== REQUIRED_CONSTRAINTS.size
    || [...REQUIRED_CONSTRAINTS].some((name) => !names.has(name))
  ) {
    return wireError(
      "code-check report omitted a required constraint",
      EXECUTOR_FAILURE_STATUS,
    );
  }
};

const validateReport = (
  value: unknown,
  request: EvolutionCodeCheckRequest,
): EvolutionCodeCheckReport => {
  const report = decodeUnknown(
    EvolutionCodeCheckReport,
    value,
    "code-check report",
  );
  if (
    report.runId !== request.run.id
    || report.candidateId !== request.candidate.id
    || report.candidateDigest !== request.candidate.candidateDigest
  ) {
    return wireError(
      "code-check report does not attest the request",
      EXECUTOR_FAILURE_STATUS,
    );
  }
  validateConstraintNames(report.constraints);
  return report;
};

export const checkCandidate = async (
  value: unknown,
): Promise<EvolutionCodeCheckReport> => {
  const request = validateRequest(value);
  const result = Bun.env["ELLIOTT_DARWIN_FIXTURE"] === "1"
    ? fixtureReport(request)
    : await execute(request);
  return validateReport(result, request);
};
