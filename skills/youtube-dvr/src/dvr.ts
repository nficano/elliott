import {
  dateKey,
  localHour,
  parseTargetDate,
  playlistTitle,
  weekdayShort,
} from "./calendar";
import type {
  DvrDeps,
  DvrEngine,
  DvrRun,
  DvrRunOptions,
  DvrRunResult,
  SourceProvider,
  Upload,
} from "./types";
import { videoIdFromUrl } from "./youtube";

const MILLISECONDS_PER_SECOND = 1000;

export const makeDvrEngine = (deps: DvrDeps): DvrEngine => ({
  run: (options) => runOnce(deps, options),
});

const runOnce = async (
  deps: DvrDeps,
  options: DvrRunOptions,
): Promise<DvrRunResult> => {
  const { settings } = deps;
  const now = new Date();
  const backfill = options.date !== undefined;
  const target = options.date === undefined
    ? now
    : parseTargetDate(options.date);
  if (!backfill && !withinWindow(now, deps)) {
    return {
      playlist: "",
      playlistId: "",
      added: [],
      skipped: 0,
      note: "outside active window",
    };
  }
  const key = dateKey(target, settings.timezone);
  const title = playlistTitle(
    settings.playlistTitleTemplate,
    target,
    settings.timezone,
  );
  const playlistId = await ensurePlaylist(deps, key, title);
  const candidates = await gatherCandidates({ deps, target, backfill });
  const added = await fileCandidates(deps, playlistId, candidates);
  return {
    playlist: title,
    playlistId,
    added,
    skipped: candidates.length - added.length,
  };
};

const withinWindow = (now: Date, deps: DvrDeps): boolean => {
  const hour = localHour(now, deps.settings.timezone);
  const start = deps.settings.windowStartHour;
  const end = deps.settings.windowEndHour;
  return end <= start
    ? hour >= start || hour < end
    : hour >= start && hour < end;
};

const ensurePlaylist = async (
  deps: DvrDeps,
  key: string,
  title: string,
): Promise<string> => {
  const state = await deps.store.load();
  const existing = state.playlists[key];
  if (existing !== undefined) return existing;
  const created = await deps.client.createPlaylist(
    title,
    deps.settings.playlistPrivacy,
  );
  await deps.store.setPlaylist(key, created);
  return created;
};

const gatherCandidates = async (run: DvrRun): Promise<readonly string[]> => {
  const ids: string[] = [];
  for (const handle of run.deps.settings.channels) {
    ids.push(...(await channelVideoIds(run, handle)));
  }
  ids.push(...(await providerVideoIds(run)));
  return [...new Set(ids)];
};

const channelVideoIds = async (
  run: DvrRun,
  handle: string,
): Promise<readonly string[]> => {
  try {
    const uploads = await run.deps.client.uploads(handle);
    return selectUploads(run, uploads).map((upload) => upload.videoId);
  } catch (error) {
    run.deps.report(error, `youtube-dvr:uploads:${handle}`);
    return [];
  }
};

const selectUploads = (
  run: DvrRun,
  uploads: readonly Upload[],
): readonly Upload[] => {
  const timezone = run.deps.settings.timezone;
  if (run.backfill) {
    const wanted = dateKey(run.target, timezone);
    return uploads.filter((upload) =>
      upload.publishedAt.length > 0
      && dateKey(new Date(upload.publishedAt), timezone) === wanted
    );
  }
  const cutoff = Date.now()
    - run.deps.settings.lookbackSeconds * MILLISECONDS_PER_SECOND;
  return uploads.filter((upload) => Date.parse(upload.publishedAt) >= cutoff);
};

const providerVideoIds = async (run: DvrRun): Promise<readonly string[]> => {
  const weekday = weekdayShort(run.target, run.deps.settings.timezone);
  const ids: string[] = [];
  for (const provider of run.deps.providers) {
    if (!providerActive(provider, weekday)) continue;
    const id = await resolveProvider(run, provider);
    if (id !== undefined) ids.push(id);
  }
  return ids;
};

const providerActive = (
  provider: SourceProvider,
  weekday: string,
): boolean => provider.days.length === 0 || provider.days.includes(weekday);

const resolveProvider = async (
  run: DvrRun,
  provider: SourceProvider,
): Promise<string | undefined> => {
  try {
    const url = await provider.resolve();
    return url === undefined ? undefined : videoIdFromUrl(url);
  } catch (error) {
    run.deps.report(error, `youtube-dvr:provider:${provider.name}`);
    return undefined;
  }
};

const fileCandidates = async (
  deps: DvrDeps,
  playlistId: string,
  ids: readonly string[],
): Promise<readonly string[]> => {
  const state = await deps.store.load();
  const already = new Set(state.addedVideoIds);
  const added: string[] = [];
  for (const id of ids) {
    if (already.has(id)) continue;
    if (await shouldFile(deps, id) && await file(deps, playlistId, id)) {
      added.push(id);
    }
  }
  return added;
};

const shouldFile = async (deps: DvrDeps, id: string): Promise<boolean> => {
  try {
    return (await deps.client.durationSeconds(id))
      >= deps.settings.minDurationSeconds;
  } catch (error) {
    deps.report(error, `youtube-dvr:duration:${id}`);
    return false;
  }
};

const file = async (
  deps: DvrDeps,
  playlistId: string,
  id: string,
): Promise<boolean> => {
  try {
    await deps.client.addToPlaylist(playlistId, id);
    await deps.store.markAdded(id);
    return true;
  } catch (error) {
    deps.report(error, `youtube-dvr:add:${id}`);
    return false;
  }
};
