import * as Effect from "effect/Effect";
import type { IntegrationError } from "../../integrations/http.js";
import { apiGet, apiPost, PAGE_SIZE } from "./request.js";
import {
  PlaylistCreateResponseSchema,
  PlaylistItemInsertResponseSchema,
  PlaylistItemsResponseSchema,
  PlaylistListResponseSchema,
} from "./schema.js";
import type {
  PlaylistEntry,
  PlaylistItemInsert,
  YoutubeApiDeps,
} from "./types.js";

/** Playlist reads and writes — the run.py playlist half of the engine. */

/** run.py `fetch_existing_items` — every (videoId, videoPublishedAt). */
export const playlistItems = Effect.fn("skillsYoutube.playlistItems")(
  function*(deps: YoutubeApiDeps, playlistId: string) {
    const entries: PlaylistEntry[] = [];
    let pageToken = "";
    do {
      const query: Record<string, string> = {
        part: "contentDetails",
        playlistId,
        maxResults: PAGE_SIZE,
      };
      if (pageToken !== "") query.pageToken = pageToken;
      const data = yield* apiGet({
        deps,
        path: "playlistItems",
        query,
        schema: PlaylistItemsResponseSchema,
      });
      for (const item of data.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        if (videoId !== undefined) {
          entries.push({
            videoId,
            publishedAt: item.contentDetails?.videoPublishedAt ?? "",
          });
        }
      }
      pageToken = data.nextPageToken ?? "";
    } while (pageToken !== "");
    return entries;
  },
);

/**
 * The idempotency scan from run.py `find_or_create_playlist`: paginate ALL
 * of the user's playlists looking for an exact title match — with no
 * persistent cache this scan is what guarantees ≤1 playlist per day.
 */
export const findPlaylistByTitle = Effect.fn(
  "skillsYoutube.findPlaylistByTitle",
)(
  function*(deps: YoutubeApiDeps, title: string) {
    let pageToken = "";
    do {
      const query: Record<string, string> = {
        part: "snippet",
        mine: "true",
        maxResults: PAGE_SIZE,
      };
      if (pageToken !== "") query.pageToken = pageToken;
      const data = yield* apiGet({
        deps,
        path: "playlists",
        query,
        schema: PlaylistListResponseSchema,
      });
      for (const item of data.items ?? []) {
        if (item.snippet?.title === title) return item.id;
      }
      pageToken = data.nextPageToken ?? "";
    } while (pageToken !== "");
    return undefined;
  },
);

export function createPlaylist(params: {
  readonly deps: YoutubeApiDeps;
  readonly title: string;
  readonly privacy: string;
}): Effect.Effect<string, IntegrationError> {
  return apiPost({
    deps: params.deps,
    path: "playlists",
    query: { part: "snippet,status" },
    body: {
      snippet: { title: params.title },
      status: { privacyStatus: params.privacy },
    },
    schema: PlaylistCreateResponseSchema,
  }).pipe(Effect.map((created) => created.id));
}

/** run.py `add_to_playlist` with an explicit `snippet.position`. */
export function insertPlaylistItem(
  deps: YoutubeApiDeps,
  input: PlaylistItemInsert,
): Effect.Effect<unknown, IntegrationError> {
  return apiPost({
    deps,
    path: "playlistItems",
    query: { part: "snippet" },
    body: {
      snippet: {
        playlistId: input.playlistId,
        resourceId: { kind: "youtube#video", videoId: input.videoId },
        position: input.position,
      },
    },
    schema: PlaylistItemInsertResponseSchema,
  });
}
