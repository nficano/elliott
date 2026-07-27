import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlertStore } from "./types";

const MAX_ALERTED = 500;

export const makeAlertStore = (directory: string): AlertStore => {
  const file = path.join(directory, "alerted.json");
  const serialize = makeSerializer();
  return {
    seen: () => serialize(async () => new Set(await load(file))),
    mark: (key) =>
      serialize(async () => {
        const keys = await load(file);
        if (keys.includes(key)) return;
        await save(file, [...keys, key].slice(-MAX_ALERTED));
      }),
  };
};

const makeSerializer = (): <T>(work: () => Promise<T>) => Promise<T> => {
  let queue: Promise<unknown> = Promise.resolve();
  return (work) => {
    const next = queue.catch(() => undefined).then(work);
    queue = next.catch(() => undefined);
    return next;
  };
};

const load = async (file: string): Promise<readonly string[]> => {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const save = async (
  file: string,
  keys: readonly string[],
): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const scratch = `${file}.tmp`;
  await writeFile(scratch, JSON.stringify(keys, undefined, 2), "utf8");
  await rename(scratch, file);
};
