import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_MIN_COUNT = 20;
const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_FEED_LIMIT = 10;
const DEFAULT_COOLDOWN_HOURS = 6;
const DEFAULT_CHANGE_WINDOW_MINUTES = 60;

export const SpikeWatchConfig = Schema.StructWithRest(
  Schema.Struct({
    min_count: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_MIN_COUNT)),
    ),
    window_hours: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_WINDOW_HOURS)),
    ),
    feed_limit: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_FEED_LIMIT)),
    ),
    cooldown_hours: Schema.Number.check(Schema.isGreaterThan(0)).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_COOLDOWN_HOURS)),
    ),
    change_window_min: Schema.Number.check(Schema.isGreaterThan(0)).pipe(
      Schema.withDecodingDefault(
        Effect.succeed(DEFAULT_CHANGE_WINDOW_MINUTES),
      ),
    ),
    ignore_substrings: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    /** Self-guard identity (TDD §9.3) — how alerts about THIS agent look. */
    self_project_slug: Schema.optional(Schema.String),
    self_project_id: Schema.optional(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
