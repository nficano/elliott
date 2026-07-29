import type { PiholeBackend } from "./types";

const LABEL = /^[a-z\d][a-z\d-]*$/i;
const ADDRESS = /^[\da-f.:]+$/i;

export const hostname = (value: string): string => {
  const labels = value.split(".");
  const invalid = labels.some((label) =>
    !LABEL.test(label) || label.endsWith("-")
  );
  if (invalid) throw new Error(`Invalid hostname: ${value}`);
  return value.toLowerCase();
};

export const address = (value: string): string => {
  if (!ADDRESS.test(value)) throw new Error(`Invalid IP address: ${value}`);
  return value;
};

// Clears every host entry and CNAME alias Pi-hole serves for a domain so a
// subsequent add replaces rather than accumulates. Returns how many records
// went away.
export const removeDomain = async (
  api: PiholeBackend,
  domain: string,
): Promise<number> => {
  const current = await api.snapshot();
  let removed = 0;
  for (const record of current.hosts) {
    if (!record.domains.includes(domain)) continue;
    await api.removeHost(record, domain);
    removed += 1;
  }
  for (const record of current.cnames) {
    if (record.alias !== domain) continue;
    await api.removeCname(record);
    removed += 1;
  }
  return removed;
};
