import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadTopology } from "../../../skills/deep-trace/src/topology";

const root = path.resolve(import.meta.dir, "../../..");
const topologyPath = path.join(root, "docs/elliott-topology.enriched.json");

describe("loadTopology", () => {
  it("serves the enriched topology document verbatim", async () => {
    const served = await loadTopology();
    const onDisk = await readFile(topologyPath, "utf8");
    expect(served).toBe(onDisk);
  });

  it("returns valid JSON with the verified graph shape", async () => {
    const parsed = JSON.parse(await loadTopology()) as {
      nodes: { id: string; kind: string; }[];
      edges: { id: string; from: string; to: string; }[];
      domains: { id: string; }[];
    };
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(parsed.edges.length).toBeGreaterThan(0);
    expect(parsed.domains.length).toBeGreaterThan(0);
    const nodeIds = new Set(parsed.nodes.map((node) => node.id));
    for (const edge of parsed.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });

  it("caches the document across calls", async () => {
    const first = await loadTopology();
    const second = await loadTopology();
    expect(second).toBe(first);
  });
});
