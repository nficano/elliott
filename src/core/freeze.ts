const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const deepFreeze = (value: unknown): void => {
  if (!isRecord(value) || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) deepFreeze(nested);
  Object.freeze(value);
};
