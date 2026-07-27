const HOURS_PER_DAY = 24;
const ORDINAL_HUNDRED = 100;
const ORDINAL_TEEN_LOW = 11;
const ORDINAL_TEEN_HIGH = 13;
const ORDINAL_TEN = 10;
const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = {
  1: "st",
  2: "nd",
  3: "rd",
};

const partsOf = (
  date: Date,
  timezone: string,
): Readonly<Record<string, string>> => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) out[part.type] = part.value;
  return out;
};

export const dateKey = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export const localHour = (date: Date, timezone: string): number => {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number(value) % HOURS_PER_DAY;
};

export const weekdayShort = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    .format(date)
    .toLowerCase();

export const playlistTitle = (
  template: string,
  date: Date,
  timezone: string,
): string => {
  const parts = partsOf(date, timezone);
  const day = Number(parts["day"] ?? "1");
  return template
    .replaceAll("{dayName}", () => parts["weekday"] ?? "")
    .replaceAll("{month}", () => parts["month"] ?? "")
    .replaceAll("{day}", () => String(day))
    .replaceAll("{ordinal}", () => ordinal(day));
};

export const parseTargetDate = (value: string): Date => {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Unparseable target date: ${value}`);
  }
  return date;
};

const ordinal = (value: number): string => {
  const teens = value % ORDINAL_HUNDRED;
  if (teens >= ORDINAL_TEEN_LOW && teens <= ORDINAL_TEEN_HIGH) return "th";
  return ORDINAL_SUFFIXES[value % ORDINAL_TEN] ?? "th";
};
