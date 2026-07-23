import type {
  DateParts,
  InsertPoint,
  InsertStep,
  LocalClock,
  PlaylistEntry,
  PollGate,
  PollGateInput,
  WindowCheckInput,
} from "./types.js";

/**
 * Pure engine logic ported from the youtube-dvr daemon (`run.py`) — no
 * network, no Effect: ISO-8601 duration parsing, timezone-aware date/window
 * math, playlist-title templating, and the bisect-based chronological insert
 * plan. Everything here is deterministic given its inputs, so this is the
 * unit-tested surface; the tools stay thin.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const DURATION_UNIT_SECONDS: Record<string, number> = {
  H: SECONDS_PER_HOUR,
  M: SECONDS_PER_MINUTE,
  S: 1,
};
const ORDINAL_TEEN_LOW = 11;
const ORDINAL_TEEN_HIGH = 13;
const CENTURY = 100;
const DECADE = 10;
const ORDINAL_THIRD = 3;
const ISO_DATE_SEGMENTS = 3;
const MIDNIGHT = "00:00";

/** Port of run.py `parse_iso_duration`: "PT1H2M3S" → 3723; unparseable → 0. */
export function parseIsoDuration(iso: string): number {
  if (!iso.startsWith("PT")) return 0;
  let total = 0;
  let digits = "";
  for (const char of iso.slice(2)) {
    if (char >= "0" && char <= "9") {
      digits += char;
      continue;
    }
    const unit = DURATION_UNIT_SECONDS[char];
    if (unit === undefined || digits === "") break;
    total += Number(digits) * unit;
    digits = "";
  }
  return total;
}

/** Port of run.py `ordinal`: 1→"st", 2→"nd", 3→"rd", 4→"th", 11–13→"th". */
export function ordinalSuffix(day: number): string {
  const teen = day % CENTURY;
  if (teen >= ORDINAL_TEEN_LOW && teen <= ORDINAL_TEEN_HIGH) return "th";
  const last = day % DECADE;
  if (last === 1) return "st";
  if (last === 2) return "nd";
  if (last === ORDINAL_THIRD) return "rd";
  return "th";
}

/**
 * Port of run.py `render_playlist_title` — supported placeholders:
 * {dayName} {month} {day} {ordinal} {year} {isoDate}.
 */
export function renderTitle(template: string, parts: DateParts): string {
  return template
    .replaceAll("{dayName}", () => parts.dayName)
    .replaceAll("{month}", () => parts.month)
    .replaceAll("{day}", () => String(parts.day))
    .replaceAll("{ordinal}", () => ordinalSuffix(parts.day))
    .replaceAll("{year}", () => String(parts.year))
    .replaceAll("{isoDate}", () => parts.isoDate);
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = clockFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  clockFormatters.set(timeZone, formatter);
  return formatter;
}

/** Wall-clock view of an instant in an IANA timezone (zoneinfo analog). */
export function localClock(epochMs: number, timeZone: string): LocalClock {
  const parts = new Map(
    clockFormatter(timeZone)
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value]),
  );
  const isoDate = `${parts.get("year")}-${parts.get("month")}-${
    parts.get("day")
  }`;
  const minutesOfDay = Number(parts.get("hour")) * MINUTES_PER_HOUR
    + Number(parts.get("minute"));
  return {
    isoDate,
    minutesOfDay,
    weekday: (parts.get("weekday") ?? "").toLowerCase(),
  };
}

/** Title parts for an explicit "YYYY-MM-DD" (the date-override path). */
export function datePartsFromIsoDate(isoDate: string): DateParts {
  const [yearRaw = "", monthRaw = "", dayRaw = ""] = isoDate.split(
    "-",
    ISO_DATE_SEGMENTS,
  );
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    dayName: DAY_NAMES[weekday] ?? "",
    month: MONTH_NAMES[month - 1] ?? "",
    day,
    year,
    isoDate,
  };
}

/** Title parts for "today" as seen from an IANA timezone. */
export function datePartsInZone(
  epochMs: number,
  timeZone: string,
): DateParts {
  return datePartsFromIsoDate(localClock(epochMs, timeZone).isoDate);
}

/** "HH:MM" → minutes of day. */
export function parseHhMm(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":", 2);
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
}

/**
 * Port of run.py `is_in_window`: the video must be published on the
 * reference instant's local date, at or after `window.start`, and — unless
 * `window.end` is "00:00" (midnight next day) — at or before `window.end`.
 */
export function isInWindow(input: WindowCheckInput): boolean {
  const publishedMs = Date.parse(input.publishedAt);
  if (Number.isNaN(publishedMs)) return false;
  const published = localClock(publishedMs, input.timeZone);
  const reference = localClock(input.referenceMs, input.timeZone);
  if (published.isoDate !== reference.isoDate) return false;
  if (published.minutesOfDay < parseHhMm(input.window.start)) return false;
  if (input.window.end === MIDNIGHT) return true;
  return published.minutesOfDay <= parseHhMm(input.window.end);
}

/**
 * Port of run.py `should_poll_channel`: skip a channel when today (in the
 * given timezone) is not in its `days` filter, or when the local time is
 * still before its earliest `time`.
 */
export function channelPollGate(input: PollGateInput): PollGate {
  const local = localClock(input.referenceMs, input.timeZone);
  const days = (input.days ?? []).map((day) => day.toLowerCase());
  if (days.length > 0 && !days.includes(local.weekday)) {
    return { poll: false, reason: `not scheduled on ${local.weekday}` };
  }
  if (input.time !== undefined && local.minutesOfDay < parseHhMm(input.time)) {
    return { poll: false, reason: `before earliest time ${input.time}` };
  }
  return { poll: true };
}

function compareEntries(a: PlaylistEntry, b: PlaylistEntry): number {
  if (a.publishedAt !== b.publishedAt) {
    return a.publishedAt < b.publishedAt ? -1 : 1;
  }
  if (a.videoId !== b.videoId) return a.videoId < b.videoId ? -1 : 1;
  return 0;
}

/** Ascending (publishedAt, videoId) keys — the bisect baseline. */
export function sortedInsertKeys(
  existing: readonly PlaylistEntry[],
): PlaylistEntry[] {
  return [...existing].sort(compareEntries);
}

/**
 * bisect_left over the ascending keys; the playlist position is derived as
 * `keys.length - index` because playlists order newest-first.
 */
export function insertPosition(
  keys: readonly PlaylistEntry[],
  candidate: PlaylistEntry,
): InsertPoint {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareEntries(keys[mid]!, candidate) < 0) lo = mid + 1;
    else hi = mid;
  }
  return { index: lo, position: keys.length - lo };
}

/**
 * Port of run.py `insert_candidates_chronologically`, minus the API calls:
 * process candidates newest-first, emitting for each the `snippet.position`
 * it must be inserted at so the playlist stays sorted newest→oldest.
 */
export function planChronologicalInserts(
  candidates: readonly PlaylistEntry[],
  existing: readonly PlaylistEntry[],
): InsertStep[] {
  const keys = sortedInsertKeys(existing);
  const ordered = [...candidates].sort((a, b) => compareEntries(b, a));
  const steps: InsertStep[] = [];
  for (const candidate of ordered) {
    const point = insertPosition(keys, candidate);
    steps.push({ videoId: candidate.videoId, position: point.position });
    keys.splice(point.index, 0, candidate);
  }
  return steps;
}

/**
 * Normalize a playlist reference to its Data-API id. Accepts a raw id
 * (`PL…`/`UU…`/`FL…`/`OL…`/`RD…`), the `VL`-prefixed UI form, and URLs that
 * carry either — `watch?v=…&list=PL…`, `playlist?list=PL…`, and the
 * `/show/VLPL…` share form. Returns undefined when nothing playlist-shaped
 * is found.
 */
export function parsePlaylistRef(input: string): string | undefined {
  const raw = input.trim();
  if (raw.length === 0) return undefined;
  const direct = playlistIdOf(raw);
  if (direct !== undefined) return direct;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const list = url.searchParams.get("list");
  if (list !== null) return playlistIdOf(list);
  for (const segment of url.pathname.split("/")) {
    const id = playlistIdOf(segment);
    if (id !== undefined) return id;
  }
  return undefined;
}

const PLAYLIST_ID_MIN_TAIL = 10;

function playlistIdOf(value: string): string | undefined {
  const unwrapped = value.startsWith("VL") ? value.slice(2) : value;
  const prefix = unwrapped.slice(0, 2);
  if (!["PL", "UU", "FL", "OL", "RD"].includes(prefix)) return undefined;
  const tail = unwrapped.slice(2);
  if (tail.length < PLAYLIST_ID_MIN_TAIL) return undefined;
  if (!/^[\w-]+$/.test(tail)) return undefined;
  return unwrapped;
}
