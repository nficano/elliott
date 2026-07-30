import { readFile } from "node:fs/promises";

// The verified enriched topology is authored once in docs/ and served
// verbatim, so the explorer, its detail drawers, and the documentation never
// drift. Spatial views are derived in ui.html from domains, trust zones,
// runtime states, criticality, node kinds, and the verified edge contracts.
const TOPOLOGY_URL = new URL(
  "../../../docs/elliott-topology.enriched.json",
  import.meta.url,
);

const state: { value: string | undefined; } = { value: undefined };

export const loadTopology = async (): Promise<string> => {
  if (state.value !== undefined) return state.value;
  const body = await readFile(TOPOLOGY_URL, "utf8");
  state.value = body;
  return body;
};
