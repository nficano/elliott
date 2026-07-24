import * as Effect from "effect/Effect";
import path from "node:path";
import { hashBytes } from "../../../core/digest";
import { EvolutionEngineError } from "../errors";
import type { EvolutionCodeSandboxContract } from "../model/index";
import type { EvolutionEngineIsolationInput } from "./types";

const DIGEST_IMAGE = /@sha256:[a-f0-9]{64}$/u;
const CANDIDATE_CHECKOUT = /^candidate:\/\/[a-zA-Z0-9._/-]+$/u;
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

const invalidSandboxPath = (requestedPath: string): boolean => {
  const normalized = path.posix.normalize(requestedPath);
  return requestedPath.length === 0
    || requestedPath.includes("\0")
    || path.posix.isAbsolute(requestedPath)
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../");
};

const invalidTestCommand = (command: readonly string[]): boolean => {
  const executable = command[0];
  if (
    executable === undefined
    || command.some((argument) => argument.length === 0)
  ) {
    return true;
  }
  return FORBIDDEN_EXECUTABLES.has(path.posix.basename(executable));
};

const invalidResourceLimits = (
  contract: EvolutionCodeSandboxContract,
): boolean =>
  !Number.isFinite(contract.cpuQuota)
  || contract.cpuQuota <= 0
  || !Number.isSafeInteger(contract.memoryMb)
  || contract.memoryMb <= 0
  || !Number.isSafeInteger(contract.pids)
  || contract.pids <= 0
  || !Number.isSafeInteger(contract.timeoutMilliseconds)
  || contract.timeoutMilliseconds <= 0;

const checkoutViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  if (
    !CANDIDATE_CHECKOUT.test(contract.checkoutRef)
    || contract.checkoutRef.includes("..")
  ) {
    return "checkoutRef must identify a candidate-only checkout";
  }
};

const targetFilesViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  const checkoutPaths = new Set(
    contract.checkoutFiles.map((file) => file.path),
  );
  if (
    contract.targetFiles.length === 0
    || contract.targetFiles.some(invalidSandboxPath)
    || contract.targetFiles.some((target) => !checkoutPaths.has(target))
  ) {
    return "targetFiles must identify relative paths in the sealed checkout";
  }
};

const checkoutFilesViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  const paths = new Set<string>();
  const invalid = contract.checkoutFiles.some((file) => {
    const duplicate = paths.has(file.path);
    paths.add(file.path);
    return duplicate
      || invalidSandboxPath(file.path)
      || file.digest !== hashBytes(file.content);
  });
  if (contract.checkoutFiles.length === 0 || invalid) {
    return "checkoutFiles must be unique, relative, and digest-verified";
  }
};

const testCommandsViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  if (
    contract.testCommands.length === 0
    || contract.testCommands.some(invalidTestCommand)
  ) {
    return "testCommands must use non-shell, non-privileged executables";
  }
};

const resourceLimitsViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  if (invalidResourceLimits(contract)) {
    return "sandbox resource limits must be positive and finite";
  }
};

const exposureViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  if (
    contract.networkEnabled
    || contract.repositoryCredentialsMounted
    || contract.gitRemotePresent
    || contract.activeTreeWritable
    || contract.containerRuntimeSocketMounted
  ) {
    return "sandbox may not expose network, credentials, remotes, active tree, or runtime socket";
  }
};

const SANDBOX_VALIDATIONS = [
  checkoutViolation,
  checkoutFilesViolation,
  targetFilesViolation,
  testCommandsViolation,
  resourceLimitsViolation,
  exposureViolation,
] as const;

const sandboxViolation = (
  contract: EvolutionCodeSandboxContract,
): string | undefined => {
  for (const validate of SANDBOX_VALIDATIONS) {
    const violation = validate(contract);
    if (violation !== undefined) {
      return violation;
    }
  }
};

export const validateCodeSandboxContract = (
  contract: EvolutionCodeSandboxContract,
): Effect.Effect<void, EvolutionEngineError> => {
  const violation = sandboxViolation(contract);
  return violation === undefined
    ? Effect.void
    : EvolutionEngineError.make({
      engineRef: "organization/evaluator/darwinian",
      operation: "validate-code-sandbox",
      cause: violation,
    });
};

export const validateEngineIsolation = (
  input: EvolutionEngineIsolationInput,
): Effect.Effect<void, EvolutionEngineError> => {
  const valid = (
    input.isolation === "container" || input.isolation === "remote"
  )
    && DIGEST_IMAGE.test(input.image)
    && !input.hasRepositoryCredentials
    && !input.hasActiveTreeWrite
    && !input.hasContainerRuntimeSocket
    && !input.holdoutReadable;
  return valid
    ? Effect.void
    : EvolutionEngineError.make({
      engineRef: input.engineRef,
      operation: "validate-isolation",
      cause:
        "engine placement violates candidate-only or holdout-secrecy policy",
    });
};
