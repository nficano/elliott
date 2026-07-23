import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import {
  channelPollGate,
  datePartsFromIsoDate,
  datePartsInZone,
  insertPosition,
  isInWindow,
  localClock,
  ordinalSuffix,
  parseHhMm,
  parseIsoDuration,
  parsePlaylistRef,
  planChronologicalInserts,
  renderTitle,
  sortedInsertKeys,
} from "../src/skills/youtube/core.js";
import { DEFAULT_TITLE_TEMPLATE } from "../src/skills/youtube/insert.js";
import { makePlaylistUploads } from "../src/skills/youtube/playlist-uploads.js";
import { apiError } from "../src/skills/youtube/request.js";
import type { YoutubeApi } from "../src/skills/youtube/types.js";
import { makeChannelUploads } from "../src/skills/youtube/uploads.js";

const NY = "America/New_York";
// 2026-07-21T16:00Z = Tuesday 12:00 EDT.
const TUESDAY_NOON_ET = Date.UTC(2026, 6, 21, 16, 0, 0);

describe("youtube core: duration parsing (run.py parse_iso_duration)", () => {
  test("parses hours/minutes/seconds in any combination", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT2H")).toBe(7200);
    expect(parseIsoDuration("PT10M")).toBe(600);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1H30S")).toBe(3630);
  });

  test("unparseable input yields 0 (parity with re.match fallthrough)", () => {
    expect(parseIsoDuration("")).toBe(0);
    expect(parseIsoDuration("P1DT2H")).toBe(0); // day components unsupported
    expect(parseIsoDuration("nonsense")).toBe(0);
  });
});

describe("youtube core: title rendering", () => {
  test("ordinal suffixes match run.py ordinal()", () => {
    expect(ordinalSuffix(1)).toBe("st");
    expect(ordinalSuffix(2)).toBe("nd");
    expect(ordinalSuffix(3)).toBe("rd");
    expect(ordinalSuffix(4)).toBe("th");
    expect(ordinalSuffix(11)).toBe("th");
    expect(ordinalSuffix(12)).toBe("th");
    expect(ordinalSuffix(13)).toBe("th");
    expect(ordinalSuffix(21)).toBe("st");
    expect(ordinalSuffix(22)).toBe("nd");
    expect(ordinalSuffix(23)).toBe("rd");
    expect(ordinalSuffix(30)).toBe("th");
    expect(ordinalSuffix(31)).toBe("st");
  });

  test("default template renders the dated playlist title", () => {
    const parts = datePartsFromIsoDate("2026-07-21");
    expect(renderTitle(DEFAULT_TITLE_TEMPLATE, parts))
      .toBe("Tuesday, July 21st");
  });

  test("supports the {year} and {isoDate} placeholders", () => {
    const parts = datePartsFromIsoDate("2026-07-03");
    expect(renderTitle("{isoDate} ({dayName} {day}{ordinal}, {year})", parts))
      .toBe("2026-07-03 (Friday 3rd, 2026)");
  });
});

describe("youtube core: timezone-aware date math", () => {
  test("localClock converts an instant to wall-clock in a zone", () => {
    const clock = localClock(TUESDAY_NOON_ET, NY);
    expect(clock.isoDate).toBe("2026-07-21");
    expect(clock.minutesOfDay).toBe(12 * 60);
    expect(clock.weekday).toBe("tuesday");
  });

  test("datePartsInZone crosses year boundaries correctly", () => {
    const epoch = Date.UTC(2026, 0, 1, 3, 0, 0); // 2025-12-31 22:00 ET
    expect(datePartsInZone(epoch, NY)).toEqual({
      dayName: "Wednesday",
      month: "December",
      day: 31,
      year: 2025,
      isoDate: "2025-12-31",
    });
    expect(datePartsInZone(epoch, "UTC")).toEqual({
      dayName: "Thursday",
      month: "January",
      day: 1,
      year: 2026,
      isoDate: "2026-01-01",
    });
  });

  test("parseHhMm converts HH:MM to minutes of day", () => {
    expect(parseHhMm("00:00")).toBe(0);
    expect(parseHhMm("06:30")).toBe(390);
    expect(parseHhMm("23:59")).toBe(1439);
  });
});

describe("youtube core: publish-time window (run.py is_in_window)", () => {
  const base = {
    window: { start: "06:00", end: "00:00" },
    timeZone: NY,
    referenceMs: TUESDAY_NOON_ET,
  };

  test("same-day publish inside the window passes", () => {
    expect(isInWindow({ ...base, publishedAt: "2026-07-21T15:30:00Z" }))
      .toBe(true); // 11:30 ET
  });

  test("publish before window start is rejected", () => {
    expect(isInWindow({ ...base, publishedAt: "2026-07-21T09:00:00Z" }))
      .toBe(false); // 05:00 ET
  });

  test("publish on another local day is rejected", () => {
    expect(isInWindow({ ...base, publishedAt: "2026-07-20T23:00:00Z" }))
      .toBe(false); // Jul 20 19:00 ET
  });

  test("an explicit end bounds the window; 00:00 means midnight", () => {
    const bounded = { ...base, window: { start: "06:00", end: "12:00" } };
    expect(isInWindow({ ...bounded, publishedAt: "2026-07-21T15:30:00Z" }))
      .toBe(true); // 11:30 ET
    expect(isInWindow({ ...bounded, publishedAt: "2026-07-21T17:00:00Z" }))
      .toBe(false); // 13:00 ET
    expect(isInWindow({ ...base, publishedAt: "2026-07-21T23:30:00Z" }))
      .toBe(true); // 19:30 ET — end "00:00" keeps the rest of the day open
  });

  test("the full-day window accepts anything published that local day", () => {
    const allDay = { ...base, window: { start: "00:00", end: "00:00" } };
    expect(isInWindow({ ...allDay, publishedAt: "2026-07-21T09:00:00Z" }))
      .toBe(true); // 05:00 ET
  });

  test("garbage timestamps are rejected, not thrown", () => {
    expect(isInWindow({ ...base, publishedAt: "not-a-date" })).toBe(false);
  });
});

describe("youtube core: channel gates (run.py should_poll_channel)", () => {
  const base = { timeZone: NY, referenceMs: TUESDAY_NOON_ET };

  test("weekday filter skips channels not scheduled today", () => {
    const gate = channelPollGate({ ...base, days: ["monday", "friday"] });
    expect(gate.poll).toBe(false);
    expect(gate.reason).toContain("tuesday");
  });

  test("weekday filter is case-insensitive and passes on a match", () => {
    expect(channelPollGate({ ...base, days: ["Tuesday"] }).poll).toBe(true);
  });

  test("earliest-time gate compares local wall-clock", () => {
    expect(channelPollGate({ ...base, time: "13:00" }).poll).toBe(false);
    expect(channelPollGate({ ...base, time: "09:00" }).poll).toBe(true);
  });

  test("no filters means always poll", () => {
    expect(channelPollGate(base).poll).toBe(true);
  });
});

describe("youtube core: chronological insert plan (run.py bisect port)", () => {
  const entry = (videoId: string, publishedAt: string) => ({
    videoId,
    publishedAt,
  });

  test("empty playlist: candidates land newest-first at 0,1,2…", () => {
    const steps = planChronologicalInserts(
      [
        entry("a", "2026-07-21T10:00:00Z"),
        entry("b", "2026-07-21T11:00:00Z"),
        entry("c", "2026-07-21T09:00:00Z"),
      ],
      [],
    );
    expect(steps).toEqual([
      { videoId: "b", position: 0 },
      { videoId: "a", position: 1 },
      { videoId: "c", position: 2 },
    ]);
  });

  test("existing items shift the computed position", () => {
    // Playlist currently newest-first: x (16:00) at 0, y (08:00) at 1.
    const steps = planChronologicalInserts(
      [entry("z", "2026-07-21T10:00:00Z")],
      [
        entry("x", "2026-07-21T16:00:00Z"),
        entry("y", "2026-07-21T08:00:00Z"),
      ],
    );
    expect(steps).toEqual([{ videoId: "z", position: 1 }]);
  });

  test("timestamp ties break on videoId, matching tuple comparison", () => {
    const steps = planChronologicalInserts(
      [
        entry("a", "2026-07-21T10:00:00Z"),
        entry("b", "2026-07-21T10:00:00Z"),
      ],
      [],
    );
    expect(steps).toEqual([
      { videoId: "b", position: 0 },
      { videoId: "a", position: 1 },
    ]);
  });

  test("items missing publishedAt sort to the oldest end, not a crash", () => {
    const steps = planChronologicalInserts(
      [entry("new", "2026-07-21T10:00:00Z")],
      [entry("ghost", ""), entry("x", "2026-07-21T16:00:00Z")],
    );
    // Ascending keys: ["", ghost] < x — "new" beats ghost, loses to x.
    expect(steps).toEqual([{ videoId: "new", position: 1 }]);
  });

  test("sortedInsertKeys + insertPosition expose the primitives", () => {
    const keys = sortedInsertKeys([
      entry("x", "2026-07-21T16:00:00Z"),
      entry("y", "2026-07-21T08:00:00Z"),
    ]);
    expect(keys.map((k) => k.videoId)).toEqual(["y", "x"]);
    const point = insertPosition(keys, entry("z", "2026-07-21T10:00:00Z"));
    expect(point).toEqual({ index: 1, position: 1 });
  });
});

describe("parsePlaylistRef", () => {
  test("raw ids pass through; VL UI prefix is stripped", () => {
    expect(parsePlaylistRef("PLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7"))
      .toBe("PLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7");
    expect(parsePlaylistRef("VLPLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7"))
      .toBe("PLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7");
  });

  test("show URLs (the share form) resolve to the playlist id", () => {
    expect(
      parsePlaylistRef(
        "https://www.youtube.com/show/VLPLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7?sbp=KgtXVjI5UjFNMjVuOEAB",
      ),
    ).toBe("PLBVNJo7nhINQ6qGkFlgtK-0GW0_NOS4k7");
  });

  test("playlist and watch URLs use the list param", () => {
    expect(
      parsePlaylistRef("https://www.youtube.com/playlist?list=PLabcdefghijk"),
    ).toBe("PLabcdefghijk");
    expect(
      parsePlaylistRef(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=OLabcdefghijk",
      ),
    ).toBe("OLabcdefghijk");
  });

  test("non-playlist input is rejected", () => {
    expect(parsePlaylistRef("")).toBeUndefined();
    expect(parsePlaylistRef("@somehandle")).toBeUndefined();
    expect(parsePlaylistRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toBeUndefined();
    expect(parsePlaylistRef("PLshort")).toBeUndefined();
    expect(parsePlaylistRef("XXBVNJo7nhINQ6qGkFlgtK")).toBeUndefined();
  });
});

describe("youtube uploads: per-source resilience", () => {
  const row = {
    videoId: "v1",
    title: "t",
    publishedAt: "2026-07-21T17:00:00Z",
  };
  const meta = new Map([
    ["v1", { publishedAt: row.publishedAt, title: "t", durationSeconds: 900 }],
  ]);
  const api = (failFor: string): YoutubeApi => ({
    resolveChannelId: (handle) =>
      handle === failFor
        ? Effect.fail(apiError("HTTP 404: uploads playlist missing"))
        : Effect.succeed(`chan:${handle}`),
    uploadsPlaylistId: (id) => Effect.succeed(`UU${id}`),
    recentUploads: (playlistId) =>
      playlistId === failFor
        ? Effect.fail(apiError("HTTP 404: playlist cannot be found"))
        : Effect.succeed([row]),
    videoDetails: () => Effect.succeed(meta),
    playlistItems: () => Effect.succeed([]),
    findPlaylistByTitle: () => Effect.succeed(undefined),
    createPlaylist: () => Effect.succeed("PLnew"),
    insertPlaylistItem: () => Effect.succeed({}),
  });

  test("a dead channel is skipped with its error; the sweep survives", async () => {
    const run = makeChannelUploads({
      api: api("@voidzilla"),
      now: () => TUESDAY_NOON_ET,
    });
    const out = await run({
      channels: [{ handle: "@voidzilla" }, { handle: "@ok" }],
      window: { start: "06:00", end: "24:00" },
      timezone: NY,
      min_duration_seconds: 300,
    });
    expect(out.videos.map((v) => v.video_id)).toEqual(["v1"]);
    expect(out.skipped).toEqual([
      {
        source: "@voidzilla",
        error: "youtube: HTTP 404: uploads playlist missing",
      },
    ]);
  });

  test("a bad playlist ref or 404 playlist is skipped, not fatal", async () => {
    const run = makePlaylistUploads({
      api: api("PLBVNJo7nhINQ6qGkFlgtK0GW00NOS4k7"),
      now: () => TUESDAY_NOON_ET,
    });
    const out = await run({
      playlists: [
        { playlist: "not-a-playlist" },
        { playlist: "PLBVNJo7nhINQ6qGkFlgtK0GW00NOS4k7" },
        { playlist: "PLqmQzXAOhOQieCLShXOdr4umLOAKnKoeo" },
      ],
      window: { start: "06:00", end: "24:00" },
      timezone: NY,
      min_duration_seconds: 300,
    });
    expect(out.videos.map((v) => v.video_id)).toEqual(["v1"]);
    expect(out.skipped.map((s) => s.source)).toEqual([
      "not-a-playlist",
      "PLBVNJo7nhINQ6qGkFlgtK0GW00NOS4k7",
    ]);
  });
});
