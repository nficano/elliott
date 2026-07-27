import type { RawTopology } from "#shared/types/topology";

import { buildExplorerPack } from "#shared/utils/explorer-pack";
import { compactName, runtimeTone, splitValues } from "#shared/utils/pack-nodes";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const topologyPath = path.resolve(
  __dirname,
  "../../../../docs/elliott-topology.enriched.json",
);
const raw = JSON.parse(readFileSync(topologyPath, "utf8")) as RawTopology;
const pack = buildExplorerPack(raw);

describe("buildExplorerPack against the real topology", () => {
  it("keeps every node and edge", () => {
    expect(pack.nodes.length).toBe(raw.nodes?.length);
    expect(pack.edges.length).toBe(raw.edges?.length);
  });

  it("titles the pack from the raw document", () => {
    expect(pack.meta.title).toBe(raw.title);
    expect(pack.meta.revision).toBe(raw.version);
    expect(pack.meta.id).toBe("elliott-runtime");
  });

  it("maps runtime legend entries into assumptions", () => {
    const legend = Object.entries(raw.runtimeLegend ?? {});
    expect(pack.meta.assumptions.length).toBe(legend.length);
    const [firstState, firstMeaning] = legend[0] ?? ["", ""];
    expect(pack.meta.assumptions[0]).toBe(`${firstState}: ${firstMeaning}`);
  });

  it("labels well-known nodes with their curated names", () => {
    const byId = new Map(pack.nodes.map((node) => [node.id, node]));
    expect(byId.get("runtime.agentLoop")?.name).toBe("Agent loop");
    expect(byId.get("container.postgres")?.name).toBe("Postgres");
    expect(byId.get("obs.map")?.name).toBe("Telemetry map");
  });

  it("marks database-kind nodes with the database shape", () => {
    const sqlite = pack.nodes.find((node) => node.id === "database.sessions");
    expect(sqlite?.visual.shapeClass).toBe("database");
    const loop = pack.nodes.find((node) => node.id === "runtime.agentLoop");
    expect(loop?.visual.shapeClass).toBe("system");
  });

  it("derives lifecycle tones from the runtime flag", () => {
    for (const node of pack.nodes) {
      expect(node.runtime.lifecycle).toBe(runtimeTone(node.original.runtime));
    }
  });

  it("assigns every node a layer for the Stack view", () => {
    const layerIds = new Set(pack.layers.map((layer) => layer.id));
    for (const node of pack.nodes) {
      expect(layerIds.has(node.visual.layer)).toBe(true);
    }
  });

  it("keeps the map-message flow first, followed by resolvable flows", () => {
    expect(pack.flows[0]?.id).toBe("flow:map-message");
    expect(pack.flows[0]?.steps.length).toBe(10);
    const nodeIds = new Set(pack.nodes.map((node) => node.id));
    for (const flow of pack.flows) {
      expect(flow.steps.length).toBeGreaterThan(0);
      for (const step of flow.steps) {
        expect(nodeIds.has(step.from)).toBe(true);
        expect(nodeIds.has(step.to)).toBe(true);
      }
    }
  });

  it("builds the owner-message flow from verified edges", () => {
    const owner = pack.flows.find((flow) => flow.id === "flow:owner-model");
    expect(owner).toBeDefined();
    expect(owner?.steps[0]?.from).toBe("gateway.slack");
    expect(
      owner?.consistencyNotes[0],
    ).toBe("Every step is sourced from the verified enriched topology.");
  });

  it("recolors only the edge trust zone from the neon palette", () => {
    const edgeHost = pack.hosts.find((host) => host.id === "edge");
    expect(edgeHost?.color).toBe("#39ff88");
    const substrate = pack.hosts.find((host) => host.id === "substrate");
    expect(substrate?.color).toBe("#9a8fc4");
  });

  it("gives every edge kind a motion grammar and style", () => {
    for (const edge of pack.edges) {
      expect(edge.motion.count).toBeGreaterThan(0);
      expect(edge.motion.speed).toBeGreaterThan(0);
    }
    expect(Object.keys(pack.rendering.edgeKindStyles)).toEqual(
      expect.arrayContaining(["data", "control", "persist", "learn"]),
    );
  });
});

describe("compactName", () => {
  it("prefers curated labels", () => {
    expect(compactName("whatever", "secret.vault")).toBe("Vault");
  });

  it("drops em-dash qualifiers and parentheticals", () => {
    expect(compactName("Router — attests the route", "x")).toBe("Router");
    expect(compactName("Postgres (primary)", "x")).toBe("Postgres");
  });

  it("drops the word container and capitalizes", () => {
    expect(compactName("container postgres", "x")).toBe("Postgres");
  });

  it("ellipsizes names longer than 20 characters", () => {
    const name = compactName("a very long component name indeed", "x");
    expect(name.endsWith("…")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(20);
  });

  it("falls back to Unnamed component for empty input", () => {
    expect(compactName("", "x")).toBe("Unnamed component");
    expect(compactName(undefined, "x")).toBe("Unnamed component");
  });
});

describe("splitValues", () => {
  it("splits on slash, semicolon, and comma with trimming", () => {
    expect(splitValues("a / b; c, d")).toEqual(["a", "b", "c", "d"]);
    expect(splitValues()).toEqual([]);
  });
});

describe("runtimeTone", () => {
  it("maps live to active, config-gated to migration, rest to inactive", () => {
    expect(runtimeTone("live")).toBe("active");
    expect(runtimeTone("config-gated")).toBe("migration");
    expect(runtimeTone("declared-only")).toBe("inactive");
    expect(runtimeTone()).toBe("inactive");
  });
});
