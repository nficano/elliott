import type * as Effect from "effect/Effect";
import type { IntegrationError } from "../../integrations/http.js";
import type { HttpClient } from "../../integrations/types.js";
import type {
  ChannelUploadsInputSchema,
  PlaylistInsertInputSchema,
  PlaylistUploadsInputSchema,
  YoutubeConfig,
} from "./schema.js";

export type Cfg = typeof YoutubeConfig.Type;
export type ChannelUploadsInput = typeof ChannelUploadsInputSchema.Type;
export type PlaylistUploadsInput = typeof PlaylistUploadsInputSchema.Type;
export type PlaylistInsertInput = typeof PlaylistInsertInputSchema.Type;

// ── pure core (core.ts) ──

/** Calendar parts of one local date, used to render playlist titles. */
export interface DateParts {
  readonly dayName: string;
  readonly month: string;
  readonly day: number;
  readonly year: number;
  readonly isoDate: string;
}

/** Wall-clock view of an instant in one IANA timezone. */
export interface LocalClock {
  readonly isoDate: string;
  readonly minutesOfDay: number;
  /** Lowercase English weekday name — "monday" … "sunday". */
  readonly weekday: string;
}

/** Publish-time window in local HH:MM; end "00:00" means midnight next day. */
export interface TimeWindow {
  readonly start: string;
  readonly end: string;
}

export interface WindowCheckInput {
  readonly publishedAt: string;
  readonly window: TimeWindow;
  readonly timeZone: string;
  readonly referenceMs: number;
}

export interface PollGateInput {
  readonly days?: readonly string[] | undefined;
  readonly time?: string | undefined;
  readonly timeZone: string;
  readonly referenceMs: number;
}

export interface PollGate {
  readonly poll: boolean;
  readonly reason?: string;
}

/** (videoId, publishedAt) — the chronological sort key for playlist items. */
export interface PlaylistEntry {
  readonly videoId: string;
  readonly publishedAt: string;
}

/** Where one candidate lands: splice index in the ascending key list + the
 * descending playlist position to send as `snippet.position`. */
export interface InsertPoint {
  readonly index: number;
  readonly position: number;
}

export interface InsertStep {
  readonly videoId: string;
  readonly position: number;
}

// ── OAuth (oauth.ts) ──

export interface YoutubeAuth {
  token(): Effect.Effect<string, IntegrationError>;
}

export interface MakeYoutubeAuthParams {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

// ── Data API client (api.ts) ──

export interface YoutubeApiDeps {
  readonly auth: YoutubeAuth;
  readonly http: HttpClient;
}

export interface UploadRow {
  readonly videoId: string;
  readonly title: string;
  readonly publishedAt: string;
}

export interface VideoMeta {
  readonly publishedAt: string;
  readonly title: string;
  readonly durationSeconds: number;
}

export interface PlaylistItemInsert {
  readonly playlistId: string;
  readonly videoId: string;
  readonly position: number;
}

export interface YoutubeApi {
  resolveChannelId(handle: string): Effect.Effect<string, IntegrationError>;
  uploadsPlaylistId(
    channelId: string,
  ): Effect.Effect<string, IntegrationError>;
  recentUploads(
    playlistId: string,
  ): Effect.Effect<UploadRow[], IntegrationError>;
  videoDetails(
    videoIds: readonly string[],
  ): Effect.Effect<Map<string, VideoMeta>, IntegrationError>;
  playlistItems(
    playlistId: string,
  ): Effect.Effect<PlaylistEntry[], IntegrationError>;
  findPlaylistByTitle(
    title: string,
  ): Effect.Effect<string | undefined, IntegrationError>;
  createPlaylist(
    title: string,
    privacy: string,
  ): Effect.Effect<string, IntegrationError>;
  insertPlaylistItem(
    input: PlaylistItemInsert,
  ): Effect.Effect<unknown, IntegrationError>;
}

// ── tools ──

export interface ToolDeps {
  readonly api: YoutubeApi;
  readonly now: () => number;
}

export interface VideoOut {
  readonly video_id: string;
  readonly title: string;
  readonly channel_handle: string;
  readonly published_at: string;
  readonly duration_seconds: number;
}

/** A source that errored and was skipped so the rest of the sweep survives. */
export interface SkippedSource {
  /** The channel handle or playlist ref as given in the input. */
  readonly source: string;
  readonly error: string;
}

export interface ChannelUploadsOutput {
  readonly videos: readonly VideoOut[];
  /** One bad channel/playlist (dead handle, hidden uploads) must not kill a
   * 14-source DVR sweep — failures land here instead of throwing. */
  readonly skipped: readonly SkippedSource[];
}

/** A candidate whose published_at is known (input value or videos.list backfill). */
export interface ResolvedItem {
  readonly video_id: string;
  readonly published_at: string;
}

export interface PlaylistInsertOutput {
  readonly playlist_id: string;
  readonly playlist_title: string;
  readonly inserted: readonly string[];
  readonly skipped_duplicates: number;
  /** Items whose id videos.list couldn't resolve (backfill path only). */
  readonly skipped_unknown: number;
}

export interface YoutubeOverrides {
  /** Test seam: swap fetch / the clock. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}
