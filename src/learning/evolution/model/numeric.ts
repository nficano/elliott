import * as Schema from "effect/Schema";

export const NonNegativeFiniteSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

export const PositiveFiniteSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
);

export const NonNegativeIntSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);

export const PositiveIntSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
);
