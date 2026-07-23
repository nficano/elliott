import * as Effect from "effect/Effect";
import { channelPollGate, isInWindow } from "./core.js";
import type {
  ChannelUploadsInput,
  ChannelUploadsOutput,
  SkippedSource,
  TimeWindow,
  ToolDeps,
  VideoOut,
} from "./types.js";

/**
 * `youtube_channel_uploads` — the read half of the run.py tick
 * (`collect_channel_candidates` + `should_poll_channel`): resolve each
 * handle to its uploads playlist, pull the 50 most recent uploads, and keep
 * only videos published on the reference day inside the local window and at
 * least `min_duration_seconds` long (drops Shorts and short clips).
 */

const DEFAULT_MIN_DURATION_SECONDS = 300;
const DEFAULT_TIMEZONE = "UTC";
/** start = end = "00:00" ⇒ the whole reference day. */
const FULL_DAY_WINDOW: TimeWindow = { start: "00:00", end: "00:00" };

export function makeChannelUploads(
  deps: ToolDeps,
): (input: ChannelUploadsInput) => Promise<ChannelUploadsOutput> {
  return async (input) => {
    const referenceMs = deps.now();
    const timeZone = input.timezone ?? DEFAULT_TIMEZONE;
    const window = input.window ?? FULL_DAY_WINDOW;
    const minDurationSeconds = input.min_duration_seconds
      ?? DEFAULT_MIN_DURATION_SECONDS;
    const seen = new Set<string>();
    const videos: VideoOut[] = [];
    const skipped: SkippedSource[] = [];
    for (const channel of input.channels) {
      const gate = channelPollGate({
        days: channel.days,
        time: channel.time,
        timeZone,
        referenceMs,
      });
      if (!gate.poll) continue;
      let found: VideoOut[];
      try {
        found = await channelVideos({
          deps,
          handle: channel.handle,
          window,
          timeZone,
          referenceMs,
          minDurationSeconds,
        });
      } catch (error) {
        skipped.push({
          source: channel.handle,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      for (const video of found) {
        if (seen.has(video.video_id)) continue;
        seen.add(video.video_id);
        videos.push(video);
      }
    }
    return { videos, skipped };
  };
}

async function channelVideos(params: {
  readonly deps: ToolDeps;
  readonly handle: string;
  readonly window: TimeWindow;
  readonly timeZone: string;
  readonly referenceMs: number;
  readonly minDurationSeconds: number;
}): Promise<VideoOut[]> {
  const { api } = params.deps;
  const rows = await Effect.runPromise(
    api.resolveChannelId(params.handle).pipe(
      Effect.flatMap((channelId) => api.uploadsPlaylistId(channelId)),
      Effect.flatMap((uploadsId) => api.recentUploads(uploadsId)),
    ),
  );
  const inWindow = rows.filter((row) =>
    isInWindow({
      publishedAt: row.publishedAt,
      window: params.window,
      timeZone: params.timeZone,
      referenceMs: params.referenceMs,
    })
  );
  if (inWindow.length === 0) return [];
  const details = await Effect.runPromise(
    api.videoDetails(inWindow.map((row) => row.videoId)),
  );
  return inWindow.flatMap((row) => {
    const meta = details.get(row.videoId);
    if (!meta || meta.durationSeconds < params.minDurationSeconds) return [];
    return [{
      video_id: row.videoId,
      title: meta.title || row.title,
      channel_handle: params.handle,
      published_at: meta.publishedAt || row.publishedAt,
      duration_seconds: meta.durationSeconds,
    }];
  });
}
