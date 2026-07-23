import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_SLIDE_THRESHOLD = 2;
const DEFAULT_SHARE_MIN = 0.25;
const DEFAULT_WEIGHT_MIN = 50;
const DEFAULT_SOAK_DAYS = 28;
const DEFAULT_RETIRE_DAYS = 112;
const DEFAULT_LOOKBACK_DAYS = 28;

export const WatchConfig = Schema.StructWithRest(
  Schema.Struct({
    metric: Schema.String,
    direction: Schema.Literals(["up-good", "down-good"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("up-good")),
    ),
    move_threshold: Schema.Number.pipe(
      Schema.withDecodingDefault(Effect.succeed(1)),
    ),
    activity_metric: Schema.optional(Schema.String),
    act_now_min: Schema.optional(Schema.Number),
    history_limit: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_HISTORY_LIMIT)),
    ),
    slide_threshold: Schema.Number.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_SLIDE_THRESHOLD)),
    ),
    share_min: Schema.Number.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_SHARE_MIN)),
    ),
    weight_min: Schema.Number.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_WEIGHT_MIN)),
    ),
    soak_days: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_SOAK_DAYS)),
    ),
    retire_days: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_RETIRE_DAYS)),
    ),
    days: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_LOOKBACK_DAYS)),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
