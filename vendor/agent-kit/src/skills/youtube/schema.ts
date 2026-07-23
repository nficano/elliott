import * as Schema from "effect/Schema";

const HH_MM_PATTERN = /^\d{2}:\d{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** No skill-level config — channels/windows/templates arrive as tool inputs. */
export const YoutubeConfig = Schema.Record(Schema.String, Schema.Unknown);

// ── OAuth ──

export const TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optionalKey(Schema.Number),
});

// ── Data API v3 response payloads (only the fields the engine reads) ──

export const ChannelListResponseSchema = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(
    Schema.Struct({
      id: Schema.String,
      contentDetails: Schema.optionalKey(Schema.Struct({
        relatedPlaylists: Schema.Struct({ uploads: Schema.String }),
      })),
    }),
  )),
});

export const PlaylistItemsResponseSchema = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(
    Schema.Struct({
      snippet: Schema.optionalKey(Schema.Struct({
        publishedAt: Schema.String,
        title: Schema.optionalKey(Schema.String),
        resourceId: Schema.Struct({ videoId: Schema.String }),
      })),
      contentDetails: Schema.optionalKey(Schema.Struct({
        videoId: Schema.optionalKey(Schema.String),
        videoPublishedAt: Schema.optionalKey(Schema.String),
      })),
    }),
  )),
  nextPageToken: Schema.optionalKey(Schema.String),
});

export const VideoListResponseSchema = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(
    Schema.Struct({
      id: Schema.String,
      snippet: Schema.optionalKey(Schema.Struct({
        publishedAt: Schema.String,
        title: Schema.String,
      })),
      contentDetails: Schema.optionalKey(Schema.Struct({
        duration: Schema.optionalKey(Schema.String),
      })),
    }),
  )),
});

export const PlaylistListResponseSchema = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(
    Schema.Struct({
      id: Schema.String,
      snippet: Schema.optionalKey(Schema.Struct({ title: Schema.String })),
    }),
  )),
  nextPageToken: Schema.optionalKey(Schema.String),
});

export const PlaylistCreateResponseSchema = Schema.Struct({
  id: Schema.String,
});

export const PlaylistItemInsertResponseSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
});

// ── Tool inputs ──

export const ChannelUploadsInputSchema = Schema.Struct({
  channels: Schema.Array(
    Schema.Struct({
      handle: Schema.String.check(Schema.isMinLength(1)),
      days: Schema.optional(Schema.Array(Schema.String)),
      time: Schema.optional(
        Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
      ),
    }),
  ).check(Schema.isMinLength(1)),
  window: Schema.optional(Schema.Struct({
    start: Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
    end: Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
  })),
  min_duration_seconds: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  timezone: Schema.optional(Schema.String),
});

export const PlaylistUploadsInputSchema = Schema.Struct({
  /** Playlist id or URL (raw `PL…`, `VLPL…`, watch/playlist/show URLs). */
  playlists: Schema.Array(
    Schema.Struct({
      playlist: Schema.String.check(Schema.isMinLength(1)),
      days: Schema.optional(Schema.Array(Schema.String)),
      time: Schema.optional(
        Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
      ),
    }),
  ).check(Schema.isMinLength(1)),
  window: Schema.optional(Schema.Struct({
    start: Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
    end: Schema.String.check(Schema.isPattern(HH_MM_PATTERN)),
  })),
  min_duration_seconds: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  timezone: Schema.optional(Schema.String),
});

export const PlaylistInsertInputSchema = Schema.Struct({
  /**
   * Empty is legal — run.py creates the daily playlist before gathering
   * candidates, so a quiet day still yields the playlist. `published_at` is
   * optional: consumer-scraped sources (a local skill printing a video id)
   * can't know it, so missing values are backfilled from videos.list.
   */
  items: Schema.Array(
    Schema.Struct({
      video_id: Schema.String.check(Schema.isMinLength(1)),
      published_at: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    }),
  ),
  title_template: Schema.optional(Schema.String),
  privacy: Schema.optional(Schema.Literals(["private", "public", "unlisted"])),
  date: Schema.optional(
    Schema.String.check(Schema.isPattern(ISO_DATE_PATTERN)),
  ),
  timezone: Schema.optional(Schema.String),
});
