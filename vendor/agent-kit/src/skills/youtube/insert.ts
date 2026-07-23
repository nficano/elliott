import * as Effect from "effect/Effect";
import type { IntegrationError } from "../../integrations/http.js";
import {
  datePartsFromIsoDate,
  datePartsInZone,
  planChronologicalInserts,
  renderTitle,
} from "./core.js";
import type {
  PlaylistEntry,
  PlaylistInsertInput,
  PlaylistInsertOutput,
  ResolvedItem,
  ToolDeps,
  YoutubeApi,
} from "./types.js";

/**
 * `youtube_playlist_insert` — the write half of the run.py tick: render the
 * dated title, find-or-create the playlist (the full-pagination title scan
 * IS the idempotency — no Redis here, so the scan alone guarantees ≤1
 * playlist per day), dedupe against the playlist's current contents, then
 * insert the survivors newest-first at their chronological positions.
 */

export const DEFAULT_TITLE_TEMPLATE = "{dayName}, {month} {day}{ordinal}";
const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_PRIVACY = "private";

export function makePlaylistInsert(
  deps: ToolDeps,
): (input: PlaylistInsertInput) => Promise<PlaylistInsertOutput> {
  return async (input) => {
    const parts = input.date === undefined
      ? datePartsInZone(deps.now(), input.timezone ?? DEFAULT_TIMEZONE)
      : datePartsFromIsoDate(input.date);
    const title = renderTitle(
      input.title_template ?? DEFAULT_TITLE_TEMPLATE,
      parts,
    );
    const playlistId = await Effect.runPromise(
      findOrCreatePlaylist({
        api: deps.api,
        title,
        privacy: input.privacy ?? DEFAULT_PRIVACY,
      }),
    );
    const existing = await Effect.runPromise(
      deps.api.playlistItems(playlistId),
    );
    const { resolved, unknown } = await backfillPublishedAt(
      deps.api,
      input.items,
    );
    const { fresh, skipped } = dedupeCandidates(resolved, existing);
    const inserted = await insertChronologically({
      api: deps.api,
      playlistId,
      candidates: fresh,
      existing,
    });
    return {
      playlist_id: playlistId,
      playlist_title: title,
      inserted,
      skipped_duplicates: skipped,
      skipped_unknown: unknown,
    };
  };
}

/**
 * Fill missing `published_at` from videos.list (run.py fetched metadata for
 * its skill-source candidates the same way). Ids the API can't resolve are
 * dropped and counted, not fatal — a scraped id shouldn't kill the job.
 */
async function backfillPublishedAt(
  api: YoutubeApi,
  items: PlaylistInsertInput["items"],
): Promise<{ resolved: ResolvedItem[]; unknown: number; }> {
  const missing = items
    .filter((item) => item.published_at === undefined)
    .map((item) => item.video_id);
  const meta = missing.length === 0
    ? new Map<string, { publishedAt: string; }>()
    : await Effect.runPromise(api.videoDetails(missing));
  const resolved: ResolvedItem[] = [];
  let unknown = 0;
  for (const item of items) {
    const published = item.published_at ?? meta.get(item.video_id)?.publishedAt;
    if (published === undefined) {
      unknown += 1;
      continue;
    }
    resolved.push({ video_id: item.video_id, published_at: published });
  }
  return { resolved, unknown };
}

function findOrCreatePlaylist(params: {
  readonly api: YoutubeApi;
  readonly title: string;
  readonly privacy: string;
}): Effect.Effect<string, IntegrationError> {
  return params.api.findPlaylistByTitle(params.title).pipe(
    Effect.flatMap((found) =>
      found === undefined
        ? params.api.createPlaylist(params.title, params.privacy)
        : Effect.succeed(found)
    ),
  );
}

/** Drop candidates already in the playlist (or repeated in the input). */
function dedupeCandidates(
  items: readonly ResolvedItem[],
  existing: readonly PlaylistEntry[],
): { fresh: PlaylistEntry[]; skipped: number; } {
  const seen = new Set(existing.map((entry) => entry.videoId));
  const fresh: PlaylistEntry[] = [];
  for (const item of items) {
    if (seen.has(item.video_id)) continue;
    seen.add(item.video_id);
    fresh.push({ videoId: item.video_id, publishedAt: item.published_at });
  }
  return { fresh, skipped: items.length - fresh.length };
}

/**
 * Execute the pure insert plan in order. Fails fast on the first API error:
 * everything inserted so far survives, and a retry is safe because the next
 * call re-reads the playlist and dedupes (run.py logged-and-continued
 * instead; a tool call can simply be retried).
 */
async function insertChronologically(params: {
  readonly api: YoutubeApi;
  readonly playlistId: string;
  readonly candidates: readonly PlaylistEntry[];
  readonly existing: readonly PlaylistEntry[];
}): Promise<string[]> {
  const steps = planChronologicalInserts(params.candidates, params.existing);
  const inserted: string[] = [];
  for (const step of steps) {
    await Effect.runPromise(
      params.api.insertPlaylistItem({
        playlistId: params.playlistId,
        videoId: step.videoId,
        position: step.position,
      }),
    );
    inserted.push(step.videoId);
  }
  return inserted;
}
