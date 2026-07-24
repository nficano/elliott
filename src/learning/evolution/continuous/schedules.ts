import * as Schedule from "effect/Schedule";

const MAXIMUM_RETRY_ATTEMPTS = 5;

export const evolutionWorkerRetrySchedule = Schedule.exponential(
  "1 second",
).pipe(
  Schedule.upTo({ times: MAXIMUM_RETRY_ATTEMPTS }),
);

export const evolutionBenchmarkSchedule = (
  expression: string,
  timeZone?: string,
) =>
  timeZone === undefined
    ? Schedule.cron(expression)
    : Schedule.cron(expression, timeZone);
