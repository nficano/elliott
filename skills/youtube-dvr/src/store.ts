import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonRecord } from "../../../src/providers/http";
import type { DvrState, DvrStore } from "./types";

const EMPTY: DvrState = { addedVideoIds: [], playlists: {} };

export const makeDvrStore = (directory: string): DvrStore => {
  const file = path.join(directory, "state.json");
  const serialize = makeSerializer();
  return {
    load: () => serialize(() => load(file)),
    markAdded: (videoId) =>
      serialize(async () => {
        const state = await load(file);
        if (state.addedVideoIds.includes(videoId)) return;
        await save(file, {
          ...state,
          addedVideoIds: [...state.addedVideoIds, videoId],
        });
      }),
    setPlaylist: (key, playlistId) =>
      serialize(async () => {
        const state = await load(file);
        await save(file, {
          ...state,
          playlists: { ...state.playlists, [key]: playlistId },
        });
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

const load = async (file: string): Promise<DvrState> => {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return EMPTY;
  }
  try {
    return decode(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
};

const decode = (value: unknown): DvrState => {
  if (!isJsonRecord(value)) return EMPTY;
  const ids = Array.isArray(value["addedVideoIds"])
    ? value["addedVideoIds"].filter((id): id is string =>
      typeof id === "string"
    )
    : [];
  const playlists = isJsonRecord(value["playlists"])
    ? stringMap(value["playlists"])
    : {};
  return { addedVideoIds: ids, playlists };
};

const stringMap = (
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
};

const save = async (file: string, state: DvrState): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const scratch = `${file}.tmp`;
  await writeFile(scratch, JSON.stringify(state, undefined, 2), "utf8");
  await rename(scratch, file);
};
