export const isJsonRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const jsonRecord = async (
  response: Response,
): Promise<Readonly<Record<string, unknown>>> => {
  const value: unknown = await response.json();
  if (!isJsonRecord(value)) {
    throw new Error("Provider returned a non-object payload");
  }
  return value;
};

export const nestedRecord = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined => {
  const nested = value[key];
  return isJsonRecord(nested) ? nested : undefined;
};

export const recordArray = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] => {
  const array = value[key];
  return Array.isArray(array) ? array.filter(isJsonRecord) : [];
};

export const numberVectors = (
  value: unknown,
): readonly (readonly number[])[] => {
  if (!Array.isArray(value)) return [];
  return value.map((row) =>
    Array.isArray(row)
      ? row.filter((item): item is number => typeof item === "number")
      : []
  );
};
