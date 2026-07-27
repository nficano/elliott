import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../src/providers/http";
import type { AccessTokenSource, Upload, YouTubeClient } from "./types";

const API_BASE = "https://youtube.googleapis.com/youtube/v3";
const MAX_UPLOAD_RESULTS = 10;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const URL_PATTERN =
  /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/;

export const makeYouTubeClient = (
  source: AccessTokenSource,
): YouTubeClient => {
  const api = makeApi(source);
  return {
    uploads: (handle) => channelUploads(api, handle),
    durationSeconds: (videoId) => videoDuration(api, videoId),
    createPlaylist: (title, privacy) => createPlaylist(api, title, privacy),
    addToPlaylist: (playlistId, videoId) =>
      addToPlaylist(api, playlistId, videoId),
  };
};

export const videoIdFromUrl = (url: string): string | undefined =>
  URL_PATTERN.exec(url)?.[1];

const channelUploads = async (
  api: ReturnType<typeof makeApi>,
  handle: string,
): Promise<readonly Upload[]> => {
  const channels = await api.get(
    `/channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}`,
  );
  const uploads = uploadsPlaylistId(channels);
  if (uploads === undefined) return [];
  const items = await api.get(
    `/playlistItems?part=snippet,contentDetails`
      + `&maxResults=${MAX_UPLOAD_RESULTS}&playlistId=${uploads}`,
  );
  return recordArray(items, "items").flatMap(toUpload);
};

const uploadsPlaylistId = (
  channels: Readonly<Record<string, unknown>>,
): string | undefined => {
  const first = recordArray(channels, "items")[0];
  const details = first === undefined
    ? undefined
    : nestedRecord(first, "contentDetails");
  const related = details === undefined
    ? undefined
    : nestedRecord(details, "relatedPlaylists");
  const uploads = related?.["uploads"];
  return typeof uploads === "string" ? uploads : undefined;
};

const toUpload = (
  item: Readonly<Record<string, unknown>>,
): readonly Upload[] => {
  const details = nestedRecord(item, "contentDetails");
  const snippet = nestedRecord(item, "snippet");
  const videoId = details?.["videoId"];
  if (typeof videoId !== "string") return [];
  const published = details?.["videoPublishedAt"] ?? snippet?.["publishedAt"];
  const title = snippet?.["title"];
  return [{
    videoId,
    publishedAt: typeof published === "string" ? published : "",
    title: typeof title === "string" ? title : "",
  }];
};

const videoDuration = async (
  api: ReturnType<typeof makeApi>,
  videoId: string,
): Promise<number> => {
  const payload = await api.get(`/videos?part=contentDetails&id=${videoId}`);
  const first = recordArray(payload, "items")[0];
  const details = first === undefined
    ? undefined
    : nestedRecord(first, "contentDetails");
  const duration = details?.["duration"];
  return typeof duration === "string" ? parseDuration(duration) : 0;
};

// Parse an ISO-8601 duration (e.g. "PT1H2M3S") into seconds without a
// backtracking-prone regex: accumulate digits, then apply the unit letter.
const parseDuration = (value: string): number => {
  let total = 0;
  let digits = "";
  for (const char of value) {
    if (char >= "0" && char <= "9") {
      digits += char;
      continue;
    }
    total += unitSeconds(digits, char);
    digits = "";
  }
  return total;
};

const unitSeconds = (digits: string, unit: string): number => {
  if (digits.length === 0) return 0;
  const value = Number(digits);
  if (unit === "H") return value * SECONDS_PER_HOUR;
  if (unit === "M") return value * SECONDS_PER_MINUTE;
  if (unit === "S") return value;
  return 0;
};

const createPlaylist = async (
  api: ReturnType<typeof makeApi>,
  title: string,
  privacy: string,
): Promise<string> => {
  const payload = await api.post("/playlists?part=snippet,status", {
    snippet: { title },
    status: { privacyStatus: privacy },
  });
  const id = payload["id"];
  if (typeof id !== "string") {
    throw new TypeError("YouTube did not return a playlist id");
  }
  return id;
};

const addToPlaylist = async (
  api: ReturnType<typeof makeApi>,
  playlistId: string,
  videoId: string,
): Promise<void> => {
  await api.post("/playlistItems?part=snippet", {
    snippet: {
      playlistId,
      resourceId: { kind: "youtube#video", videoId },
    },
  });
};

const makeApi = (source: AccessTokenSource) => ({
  get: async (path: string): Promise<Readonly<Record<string, unknown>>> => {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${await source.token()}` },
    });
    return decode(response);
  },
  post: async (
    path: string,
    body: unknown,
  ): Promise<Readonly<Record<string, unknown>>> => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await source.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return decode(response);
  },
});

const decode = async (
  response: Response,
): Promise<Readonly<Record<string, unknown>>> => {
  if (!response.ok) {
    throw new Error(`YouTube API returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isJsonRecord(payload)) {
    throw new TypeError("YouTube API returned an invalid payload");
  }
  return payload;
};
