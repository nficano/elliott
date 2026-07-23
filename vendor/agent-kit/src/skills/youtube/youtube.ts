import { define } from "../../core/agent/index.js";
import type { ToolDef, ToolMeta } from "../../core/agent/types.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { makeHttp } from "../../integrations/http.js";
import { makeYoutubeApi } from "./api.js";
import { makePlaylistInsert } from "./insert.js";
import { makeYoutubeAuth } from "./oauth.js";
import { makePlaylistUploads } from "./playlist-uploads.js";
import {
  ChannelUploadsInputSchema,
  PlaylistInsertInputSchema,
  PlaylistUploadsInputSchema,
  YoutubeConfig,
} from "./schema.js";
import type { Cfg, YoutubeOverrides } from "./types.js";
import { makeChannelUploads } from "./uploads.js";

/**
 * `youtube` skill — playlist curation over the YouTube Data API v3, the
 * generic engine of the youtube-dvr daemon (channels/windows/templates all
 * arrive as tool inputs; nothing personal is baked in).
 * `youtube_channel_uploads` (read) lists a set of channels' same-day uploads
 * through weekday/window/duration gates; `youtube_playlist_insert` (write)
 * find-or-creates the dated playlist idempotently and inserts candidates at
 * their chronological positions. Auth is the refresh-token OAuth flow with
 * the token cached in memory. Disabled by default (§5).
 */

const READ_META: ToolMeta = {
  componentId: "youtube",
  bundle: "web",
  core: false,
  write: false,
};
const WRITE_META: ToolMeta = { ...READ_META, write: true };

const manifest: Manifest<Cfg> = {
  id: "youtube",
  kind: "skill",
  version: "0.1.0",
  configSchema: YoutubeConfig,
  bundle: "web",
  trust: "write",
  defaultTier: "standard",
  capabilities: ["reads:web", "writes:playlist"],
  contracts: {
    tools: [
      "youtube_channel_uploads",
      "youtube_playlist_uploads",
      "youtube_playlist_insert",
    ],
  },
  secrets: [
    { name: "client_id", description: "Google OAuth client ID" },
    { name: "client_secret", description: "Google OAuth client secret" },
    {
      name: "refresh_token",
      description: "OAuth refresh token with the youtube.force-ssl scope",
    },
  ],
};

export function youtubeSkill(
  overrides: YoutubeOverrides = {},
): Registrable<Cfg> {
  return {
    manifest,
    async activate(ctx) {
      const now = overrides.now ?? (() => Date.now());
      const fetchOpts = overrides.fetchImpl
        ? { fetchImpl: overrides.fetchImpl }
        : {};
      const auth = makeYoutubeAuth({
        clientId: ctx.secrets.client_id!,
        clientSecret: ctx.secrets.client_secret!,
        refreshToken: ctx.secrets.refresh_token!,
        now,
        ...fetchOpts,
      });
      const api = makeYoutubeApi({
        auth,
        http: makeHttp("youtube", fetchOpts),
      });
      return {
        tools: [
          uploadsTool(makeChannelUploads({ api, now })),
          playlistUploadsTool(makePlaylistUploads({ api, now })),
        ],
        writeTools: [insertTool(makePlaylistInsert({ api, now }))],
      };
    },
  };
}

export function youtubePack(
  overrides: YoutubeOverrides = {},
): Registrable[] {
  return [youtubeSkill(overrides)];
}

function uploadsTool(
  run: ReturnType<typeof makeChannelUploads>,
): ToolDef {
  return define({
    name: "youtube_channel_uploads",
    description:
      "List today's uploads from YouTube channels (by @handle or UC… channel id), filtered by an "
      + "optional local publish-time window (HH:MM, end 00:00 = midnight), per-channel weekday/"
      + "earliest-time gates, and a minimum duration in seconds (default 300 — drops Shorts). "
      + "Returns video_id/title/channel_handle/published_at/duration_seconds per video.",
    schema: ChannelUploadsInputSchema,
    meta: READ_META,
    run: async (args) => {
      try {
        return JSON.stringify(await run(args));
      } catch (error) {
        return JSON.stringify({ error: formatUnknownError(error) });
      }
    },
  });
}

function playlistUploadsTool(
  run: ReturnType<typeof makePlaylistUploads>,
): ToolDef {
  return define({
    name: "youtube_playlist_uploads",
    description:
      "List videos newly ADDED today to YouTube playlists (a show's playlist, a topic playlist). "
      + "Accepts a playlist id or URL (PL…, VLPL…, watch/playlist/show links) per source, with the "
      + "same local window, per-source weekday/earliest-time gates, and minimum duration as "
      + "youtube_channel_uploads. Gates on added-to-playlist time; returns the video's true "
      + "publish time in published_at. Use channel_uploads for channels, this for playlists.",
    schema: PlaylistUploadsInputSchema,
    meta: READ_META,
    run: async (args) => {
      try {
        return JSON.stringify(await run(args));
      } catch (error) {
        return JSON.stringify({ error: formatUnknownError(error) });
      }
    },
  });
}

function insertTool(
  run: ReturnType<typeof makePlaylistInsert>,
): ToolDef {
  return define({
    name: "youtube_playlist_insert",
    description:
      "Insert videos into a dated YouTube playlist, creating it if needed. Renders the title from "
      + "title_template (placeholders {dayName} {month} {day} {ordinal} {year} {isoDate}) for "
      + "date/timezone, reuses an existing playlist with that exact title (≤1 per day), skips "
      + "videos already present, and inserts the rest at their chronological (newest-first) "
      + "positions. Returns playlist_id/playlist_title/inserted/skipped_duplicates.",
    schema: PlaylistInsertInputSchema,
    meta: WRITE_META,
    run: async (args) => {
      try {
        return JSON.stringify(await run(args));
      } catch (error) {
        return JSON.stringify({ error: formatUnknownError(error) });
      }
    },
  });
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
