import * as Effect from "effect/Effect";
import type { IntegrationError } from "../../integrations/http.js";
import { parseIsoDuration } from "./core.js";
import {
  createPlaylist,
  findPlaylistByTitle,
  insertPlaylistItem,
  playlistItems,
} from "./playlists.js";
import { apiError, apiGet, PAGE_SIZE } from "./request.js";
import {
  ChannelListResponseSchema,
  PlaylistItemsResponseSchema,
  VideoListResponseSchema,
} from "./schema.js";
import type {
  UploadRow,
  VideoMeta,
  YoutubeApi,
  YoutubeApiDeps,
} from "./types.js";

/**
 * Thin YouTube Data API v3 client over the shared http core. The handle→id
 * and channel→uploads-playlist lookups are cached in memory for the life of
 * the activation (the Redis `ytdvr:handle:*` / `ytdvr:uploads:*` analog).
 */

const VIDEO_BATCH = 50;
const CHANNEL_ID_LENGTH = 24;

export function makeYoutubeApi(deps: YoutubeApiDeps): YoutubeApi {
  const handleCache = new Map<string, string>();
  const uploadsCache = new Map<string, string>();
  return {
    resolveChannelId: (handle) =>
      resolveChannelId({ deps, handle, cache: handleCache }),
    uploadsPlaylistId: (channelId) =>
      uploadsPlaylistId({ deps, channelId, cache: uploadsCache }),
    recentUploads: (playlistId) => recentUploads(deps, playlistId),
    videoDetails: (videoIds) => videoDetails(deps, videoIds),
    playlistItems: (playlistId) => playlistItems(deps, playlistId),
    findPlaylistByTitle: (title) => findPlaylistByTitle(deps, title),
    createPlaylist: (title, privacy) =>
      createPlaylist({ deps, title, privacy }),
    insertPlaylistItem: (input) => insertPlaylistItem(deps, input),
  };
}

/** run.py `resolve_channel_id` — accepts a UC… id as-is, else forHandle. */
function resolveChannelId(params: {
  readonly deps: YoutubeApiDeps;
  readonly handle: string;
  readonly cache: Map<string, string>;
}): Effect.Effect<string, IntegrationError> {
  const { handle, cache } = params;
  if (handle.startsWith("UC") && handle.length === CHANNEL_ID_LENGTH) {
    return Effect.succeed(handle);
  }
  const cacheKey = handle.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return Effect.succeed(cached);
  return apiGet({
    deps: params.deps,
    path: "channels",
    query: { part: "id", forHandle: `@${handle.replace(/^@+/, "")}` },
    schema: ChannelListResponseSchema,
  }).pipe(
    Effect.flatMap((data) => {
      const id = data.items?.[0]?.id;
      if (id === undefined) {
        return Effect.fail(apiError(`no channel found for handle '${handle}'`));
      }
      cache.set(cacheKey, id);
      return Effect.succeed(id);
    }),
  );
}

/** run.py `get_uploads_playlist_id`. */
function uploadsPlaylistId(params: {
  readonly deps: YoutubeApiDeps;
  readonly channelId: string;
  readonly cache: Map<string, string>;
}): Effect.Effect<string, IntegrationError> {
  const cached = params.cache.get(params.channelId);
  if (cached !== undefined) return Effect.succeed(cached);
  return apiGet({
    deps: params.deps,
    path: "channels",
    query: { part: "contentDetails", id: params.channelId },
    schema: ChannelListResponseSchema,
  }).pipe(
    Effect.flatMap((data) => {
      const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists
        .uploads;
      if (uploads === undefined) {
        return Effect.fail(
          apiError(`channel ${params.channelId} returned no contentDetails`),
        );
      }
      params.cache.set(params.channelId, uploads);
      return Effect.succeed(uploads);
    }),
  );
}

/** The 50 most recent uploads of a channel's uploads playlist (one page). */
function recentUploads(
  deps: YoutubeApiDeps,
  playlistId: string,
): Effect.Effect<UploadRow[], IntegrationError> {
  return apiGet({
    deps,
    path: "playlistItems",
    query: { part: "snippet", playlistId, maxResults: PAGE_SIZE },
    schema: PlaylistItemsResponseSchema,
  }).pipe(
    Effect.map((data) =>
      (data.items ?? []).flatMap((item) =>
        item.snippet
          ? [{
            videoId: item.snippet.resourceId.videoId,
            title: item.snippet.title ?? "",
            publishedAt: item.snippet.publishedAt,
          }]
          : []
      )
    ),
  );
}

/** run.py `fetch_video_details` — videos.list in batches of 50. */
const videoDetails = Effect.fn("skillsYoutube.videoDetails")(
  function*(deps: YoutubeApiDeps, videoIds: readonly string[]) {
    const out = new Map<string, VideoMeta>();
    for (let start = 0; start < videoIds.length; start += VIDEO_BATCH) {
      const batch = videoIds.slice(start, start + VIDEO_BATCH);
      const data = yield* apiGet({
        deps,
        path: "videos",
        query: { part: "contentDetails,snippet", id: batch.join(",") },
        schema: VideoListResponseSchema,
      });
      for (const item of data.items ?? []) {
        out.set(item.id, {
          publishedAt: item.snippet?.publishedAt ?? "",
          title: item.snippet?.title ?? "",
          durationSeconds: parseIsoDuration(
            item.contentDetails?.duration ?? "",
          ),
        });
      }
    }
    return out;
  },
);
