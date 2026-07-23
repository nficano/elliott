import * as Effect from "effect/Effect";
import { channelPollGate, isInWindow, parsePlaylistRef } from "./core.js";
import type {
  ChannelUploadsOutput,
  PlaylistUploadsInput,
  SkippedSource,
  TimeWindow,
  ToolDeps,
  VideoOut,
} from "./types.js";

/**
 * `youtube_playlist_uploads` — the read half for playlist sources (a show's
 * playlist, a topic playlist): pull the 50 most recently added items and keep
 * only videos ADDED to the playlist on the reference day inside the window.
 * For playlistItems, `snippet.publishedAt` is the added-at instant — exactly
 * the "only new videos in this playlist" signal (shows often backfill old
 * episodes, whose original publish date would fail a publish-time gate the
 * wrong way, and re-adds should count as new). The emitted `published_at` is
 * the video's true publish time so downstream chronological insert orders
 * correctly.
 */

const DEFAULT_MIN_DURATION_SECONDS = 300;
const DEFAULT_TIMEZONE = "UTC";
/** start = end = "00:00" ⇒ the whole reference day. */
const FULL_DAY_WINDOW: TimeWindow = { start: "00:00", end: "00:00" };

export function makePlaylistUploads(
  deps: ToolDeps,
): (input: PlaylistUploadsInput) => Promise<ChannelUploadsOutput> {
  return async (input) => {
    const referenceMs = deps.now();
    const timeZone = input.timezone ?? DEFAULT_TIMEZONE;
    const window = input.window ?? FULL_DAY_WINDOW;
    const minDurationSeconds = input.min_duration_seconds
      ?? DEFAULT_MIN_DURATION_SECONDS;
    const seen = new Set<string>();
    const videos: VideoOut[] = [];
    const skipped: SkippedSource[] = [];
    for (const source of input.playlists) {
      const gate = channelPollGate({
        days: source.days,
        time: source.time,
        timeZone,
        referenceMs,
      });
      if (!gate.poll) continue;
      const found = await sourceVideos({
        deps,
        source: source.playlist,
        window,
        timeZone,
        referenceMs,
        minDurationSeconds,
      });
      if ("error" in found) {
        skipped.push({ source: source.playlist, error: found.error });
        continue;
      }
      for (const video of found.videos) {
        if (seen.has(video.video_id)) continue;
        seen.add(video.video_id);
        videos.push(video);
      }
    }
    return { videos, skipped };
  };
}

/** One source's sweep, failure-as-value so a bad playlist can't end the run. */
async function sourceVideos(params: {
  readonly deps: ToolDeps;
  readonly source: string;
  readonly window: TimeWindow;
  readonly timeZone: string;
  readonly referenceMs: number;
  readonly minDurationSeconds: number;
}): Promise<{ videos: VideoOut[]; } | { error: string; }> {
  const playlistId = parsePlaylistRef(params.source);
  if (playlistId === undefined) return { error: "not a playlist id or url" };
  try {
    return { videos: await playlistVideos({ ...params, playlistId }) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function playlistVideos(params: {
  readonly deps: ToolDeps;
  readonly playlistId: string;
  readonly window: TimeWindow;
  readonly timeZone: string;
  readonly referenceMs: number;
  readonly minDurationSeconds: number;
}): Promise<VideoOut[]> {
  const { api } = params.deps;
  const rows = await Effect.runPromise(api.recentUploads(params.playlistId));
  // Gate on ADDED-at (playlistItems snippet.publishedAt), not publish time.
  const added = rows.filter((row) =>
    isInWindow({
      publishedAt: row.publishedAt,
      window: params.window,
      timeZone: params.timeZone,
      referenceMs: params.referenceMs,
    })
  );
  if (added.length === 0) return [];
  const details = await Effect.runPromise(
    api.videoDetails(added.map((row) => row.videoId)),
  );
  return added.flatMap((row) => {
    const meta = details.get(row.videoId);
    if (!meta || meta.durationSeconds < params.minDurationSeconds) return [];
    return [{
      video_id: row.videoId,
      title: meta.title || row.title,
      channel_handle: params.playlistId,
      published_at: meta.publishedAt || row.publishedAt,
      duration_seconds: meta.durationSeconds,
    }];
  });
}
