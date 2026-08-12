/* eslint-disable complexity, unicorn/no-declarations-before-early-exit */
import * as Effect from "effect/Effect";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hashBytes } from "../../../core/digest";
import { validateCodeSandboxContract } from "../engine/isolation";
import { EvolutionDecodeError } from "../errors";
import {
  EvolutionCodeCheckoutFile,
  EvolutionCodeSandboxContract,
} from "../model/index";
import type { FileEvolutionCodeSandboxInput } from "./types";

const EXECUTABLE_MODE_MASK = 0o111;

const decodeActiveFiles = (
  input: FileEvolutionCodeSandboxInput,
): Effect.Effect<Readonly<Record<string, string>>, EvolutionDecodeError> => {
  const activeContent = input.activeContent;
  if (activeContent === undefined) return Effect.succeed({});
  return Effect.try({
    try: () => {
      const value: unknown = JSON.parse(activeContent);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("code candidate must be an object");
      }
      const files = (value as Readonly<Record<string, unknown>>)["files"];
      if (files === null || typeof files !== "object" || Array.isArray(files)) {
        throw new TypeError("code candidate must contain a files object");
      }
      const entries = Object.entries(files);
      const targetSet = new Set(input.targetFiles);
      const decoded: Record<string, string> = {};
      if (
        entries.length !== targetSet.size
        || entries.some(([name, content]) =>
          !targetSet.has(name) || typeof content !== "string"
        )
      ) throw new TypeError("code candidate files do not match targetFiles");
      for (const [name, content] of entries) {
        if (typeof content === "string") decoded[name] = content;
      }
      return decoded;
    },
    catch: (cause) =>
      EvolutionDecodeError.make({
        artifact: `active-code-target:${input.componentRef}`,
        cause,
      }),
  });
};

const canonicalMaterializedCode = (
  files: Readonly<Record<string, string>>,
): string =>
  JSON.stringify({
    files: Object.fromEntries(
      Object.entries(files).toSorted(([left], [right]) =>
        left.localeCompare(right)
      ),
    ),
  });

export const materializeFileEvolutionCodeSandbox = Effect.fn(
  "materializeFileEvolutionCodeSandbox",
  // eslint-disable-next-line max-lines-per-function
)(function*(
  input: FileEvolutionCodeSandboxInput,
) {
  const targetSet = new Set(input.targetFiles);
  const activeFiles = yield* decodeActiveFiles(input);
  const checkoutFiles = yield* Effect.forEach(
    input.checkoutPaths,
    (requestedPath) =>
      input.resolveFile(requestedPath).pipe(
        Effect.flatMap((filePath) =>
          Effect.tryPromise({
            try: async () => {
              const baseline = await readFile(filePath, "utf8");
              const content = activeFiles[requestedPath] ?? baseline;
              const metadata = await stat(filePath);
              return EvolutionCodeCheckoutFile.make({
                path: requestedPath.split(path.sep).join(path.posix.sep),
                digest: hashBytes(content),
                content,
                executable: (metadata.mode & EXECUTABLE_MODE_MASK) !== 0,
              });
            },
            catch: (cause) =>
              EvolutionDecodeError.make({
                artifact: requestedPath,
                cause,
              }),
          })
        ),
      ),
    { concurrency: 1 },
  );
  const checkoutPaths = new Set(checkoutFiles.map((file) => file.path));
  if (
    targetSet.size === 0
    || input.targetFiles.some((file) => !checkoutPaths.has(file))
  ) {
    return yield* EvolutionDecodeError.make({
      artifact: `code-target:${input.componentRef}`,
      cause: "targetFiles must be a non-empty subset of checkoutPaths",
    });
  }
  const contract = EvolutionCodeSandboxContract.make({
    checkoutRef: `candidate://${
      Buffer.from(input.componentRef).toString("base64url")
    }`,
    checkoutFiles,
    targetFiles: input.targetFiles,
    testCommands: input.testCommands,
    cpuQuota: input.cpuQuota,
    memoryMb: input.memoryMb,
    pids: input.pids,
    timeoutMilliseconds: input.timeoutMilliseconds,
    networkEnabled: false,
    repositoryCredentialsMounted: false,
    gitRemotePresent: false,
    activeTreeWritable: false,
    containerRuntimeSocketMounted: false,
  });
  yield* validateCodeSandboxContract(contract);
  const materializedFiles = Object.fromEntries(
    contract.checkoutFiles
      .filter((file) => targetSet.has(file.path))
      .map((file) => [file.path, file.content]),
  );
  return {
    baselineContent: canonicalMaterializedCode(materializedFiles),
    codeSandbox: contract,
  };
});
