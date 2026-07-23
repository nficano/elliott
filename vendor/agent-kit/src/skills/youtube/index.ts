/**
 * skills/youtube — generic YouTube playlist-curation pack, the engine of the
 * youtube-dvr daemon ported onto the registry: `youtube_channel_uploads`
 * (read) lists channels' same-day uploads through weekday/window/duration
 * gates; `youtube_playlist_insert` (write) find-or-creates the dated
 * playlist idempotently and inserts candidates chronologically. Channels,
 * windows, and title templates all arrive as tool inputs — no personal
 * config is baked in. Secrets: `client_id` / `client_secret` /
 * `refresh_token` (refresh-token OAuth, token cached in memory ~55 min).
 * Disabled by default (§5).
 */
export {
  channelPollGate,
  datePartsFromIsoDate,
  datePartsInZone,
  insertPosition,
  isInWindow,
  localClock,
  ordinalSuffix,
  parseHhMm,
  parseIsoDuration,
  planChronologicalInserts,
  renderTitle,
  sortedInsertKeys,
} from "./core.js";
export { DEFAULT_TITLE_TEMPLATE } from "./insert.js";
export { makeYoutubeAuth } from "./oauth.js";
export type {
  Cfg,
  ChannelUploadsInput,
  ChannelUploadsOutput,
  PlaylistEntry,
  PlaylistInsertInput,
  PlaylistInsertOutput,
  YoutubeOverrides,
} from "./types.js";
export { youtubePack, youtubeSkill } from "./youtube.js";
