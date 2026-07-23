/**
 * Weekday rota (CAPABILITIES-TDD §1.2/§9) — pure day-plan selection for a
 * scheduled skill that does different work on different weekdays: a weekday→task
 * map, every-other-week `alternate` slots, and round-robin rotation over a
 * target list so the whole list gets covered across weeks. Weekends are null —
 * a deliberate no-op the caller should skip WITHOUT a liveness check-in when
 * its monitor expects weekday runs only.
 */
import { MONDAY, type RotaPlan, type RotaTask, type Weekday } from "./types.js";

const SUNDAY = 0;
const SATURDAY = 6;
const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const ALTERNATING_WEEK_COUNT = 2;

/** Monday-aligned week index since epoch — stable across DST, used for
 *  `alternate` parity and list rotation. */
export function weekIndex(date: Date): number {
  const day = (date.getUTCDay() + DAYS_PER_WEEK - MONDAY) % DAYS_PER_WEEK;
  const monday =
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    - day * MILLISECONDS_PER_DAY;
  return Math.floor(monday / (DAYS_PER_WEEK * MILLISECONDS_PER_DAY));
}

export function taskForDate(plan: RotaPlan, date: Date): RotaTask | null {
  const weekday = date.getUTCDay();
  if (weekday === SUNDAY || weekday === SATURDAY) return null;
  const slot = plan[weekday as Weekday];
  if (!slot) return null;
  if (slot.alternate) {
    return slot.alternate[weekIndex(date) % ALTERNATING_WEEK_COUNT]!;
  }
  return slot.task ?? null;
}

/** Round-robin pick so a weekly slot covers the whole list across weeks. */
export function rotating<T>(list: readonly T[], date: Date): T | null {
  if (list.length === 0) return null;
  return list[weekIndex(date) % list.length]!;
}
