import * as Effect from "effect/Effect";
import {
  access,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  EvolutionContainmentError,
  EvolutionPersistenceError,
} from "../errors";

const persistenceError = (
  operation: string,
  filePath: string,
  cause: unknown,
): EvolutionPersistenceError =>
  EvolutionPersistenceError.make({ operation, path: filePath, cause });

export const containedPath = (
  root: string,
  ...segments: readonly string[]
): Effect.Effect<string, EvolutionContainmentError> => {
  const resolvedRoot = path.resolve(root);
  const requestedPath = path.resolve(resolvedRoot, ...segments);
  return requestedPath.startsWith(`${resolvedRoot}${path.sep}`)
    ? Effect.succeed(requestedPath)
    : EvolutionContainmentError.make({
      root: resolvedRoot,
      requestedPath,
    });
};

export const readText = (
  filePath: string,
): Effect.Effect<string, EvolutionPersistenceError> =>
  Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (cause) => persistenceError("read", filePath, cause),
  });

export const fileExists = (
  filePath: string,
): Effect.Effect<boolean, EvolutionPersistenceError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await access(filePath);
        return true;
      } catch (error) {
        if (
          typeof error === "object" && error !== null && "code" in error
          && error.code === "ENOENT"
        ) return false;
        throw error;
      }
    },
    catch: (cause) => persistenceError("access", filePath, cause),
  });

export const listFiles = (
  directory: string,
): Effect.Effect<readonly string[], EvolutionPersistenceError> =>
  Effect.tryPromise({
    try: () => readdir(directory),
    catch: (cause) => persistenceError("list", directory, cause),
  });

export const writeTextAtomic = (
  filePath: string,
  content: string,
): Effect.Effect<void, EvolutionPersistenceError> =>
  Effect.gen(function*() {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true }),
      catch: (cause) => persistenceError("mkdir", directory, cause),
    });
    yield* Effect.tryPromise({
      try: () => writeFile(temporaryPath, content, { flag: "wx" }),
      catch: (cause) => persistenceError("write", temporaryPath, cause),
    });
    yield* Effect.tryPromise({
      try: () => rename(temporaryPath, filePath),
      catch: (cause) => persistenceError("rename", filePath, cause),
    }).pipe(
      Effect.onError(() =>
        Effect.tryPromise({
          try: () => unlink(temporaryPath),
          catch: () => undefined,
        }).pipe(Effect.ignore)
      ),
    );
  });

export const writeTextImmutable = (
  filePath: string,
  content: string,
): Effect.Effect<void, EvolutionPersistenceError> =>
  Effect.tryPromise({
    try: async () => {
      const directory = path.dirname(filePath);
      const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, content, { flag: "wx" });
      try {
        await link(temporaryPath, filePath);
      } catch (error) {
        if (
          typeof error !== "object" || error === null || !("code" in error)
          || error.code !== "EEXIST"
        ) throw error;
        const existing = await readFile(filePath, "utf8");
        if (existing !== content) {
          throw new Error(
            `Immutable artifact already exists at ${filePath}`,
            { cause: error },
          );
        }
      } finally {
        await unlink(temporaryPath);
      }
    },
    catch: (cause) => persistenceError("write-immutable", filePath, cause),
  });
