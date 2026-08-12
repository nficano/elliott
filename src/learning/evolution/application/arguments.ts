import type { EvolutionParsedArguments } from "./types";

export const parseEvolutionArguments = (
  input: readonly string[],
): EvolutionParsedArguments => {
  const positionals: string[] = [];
  const options: Record<string, string[]> = {};
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === undefined) continue;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key.length === 0) throw new TypeError("Empty option name");
    const next = input[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new TypeError(`Option --${key} requires a value`);
    }
    const values = options[key] ?? [];
    values.push(next);
    options[key] = values;
    index += 1;
  }
  return { positionals, options };
};

export const firstOption = (
  input: EvolutionParsedArguments,
  key: string,
): string | undefined => input.options[key]?.[0];

export const integerOption = (
  input: EvolutionParsedArguments,
  key: string,
  fallback: number,
): number => {
  const value = firstOption(input, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`Option --${key} must be an integer`);
  }
  return parsed;
};

export const positiveIntegerOption = (
  input: EvolutionParsedArguments,
  key: string,
  fallback: number,
): number => {
  const value = integerOption(input, key, fallback);
  if (value <= 0) throw new TypeError(`Option --${key} must be positive`);
  return value;
};

export const positiveNumberOption = (
  input: EvolutionParsedArguments,
  key: string,
  fallback: number,
): number => {
  const raw = firstOption(input, key);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`Option --${key} must be a positive number`);
  }
  return value;
};

export const boundedPositiveIntegerOption = (
  input: EvolutionParsedArguments,
  key: string,
  configuredMaximum: number,
): number =>
  Math.min(
    positiveIntegerOption(input, key, configuredMaximum),
    configuredMaximum,
  );

export const boundedPositiveNumberOption = (
  input: EvolutionParsedArguments,
  key: string,
  configuredMaximum: number,
): number =>
  Math.min(
    positiveNumberOption(input, key, configuredMaximum),
    configuredMaximum,
  );
