import type { ExplorerNode } from "#shared/types/explorer";
import type { RawTopology } from "#shared/types/topology";

import { buildExplorerPack } from "#shared/utils/explorer-pack";
import {
  buildBoard,
  gridPositions,
  layoutDeploy,
  layoutDomains,
  layoutLayers,
  layoutView,
  shelfPack,
} from "#shared/utils/layout";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const topologyPath = path.resolve(
  __dirname,
  "../../../../docs/elliott-topology.enriched.json",
);
const raw = JSON.parse(readFileSync(topologyPath, "utf8")) as RawTopology;

const freshPack = () => buildExplorerPack(raw);

describe("gridPositions", () => {
  it("returns one column for a single node", () => {
    const pack = freshPack();
    const grid = gridPositions(pack.nodes.slice(0, 1));
    expect(grid.cols).toBe(1);
    expect(grid.rows).toBe(1);
    expect(grid.x.length).toBe(1);
  });

  it("spaces columns by node span plus clearance", () => {
    const pack = freshPack();
    const grid = gridPositions(pack.nodes.slice(0, 4), 1);
    expect(grid.cols).toBe(2);
    const [first, second] = grid.x;
    expect((second ?? 0) - (first ?? 0)).toBeCloseTo(1.62 * 1.12 + 1.15, 5);
  });
});

describe("shelfPack", () => {
  it("centers the packed rectangles around the origin", () => {
    const items = [
      { w: 4, d: 2, x: 0, z: 0 },
      { w: 4, d: 2, x: 0, z: 0 },
      { w: 4, d: 2, x: 0, z: 0 },
    ];
    const size = shelfPack(items, 1, 2.2);
    expect(size.w).toBeGreaterThan(0);
    const minX = Math.min(...items.map((item) => item.x - item.w / 2));
    const maxX = Math.max(...items.map((item) => item.x + item.w / 2));
    expect(minX + maxX).toBeCloseTo(0, 5);
  });
});

describe("buildBoard", () => {
  it("positions every node locally within its cluster", () => {
    const pack = freshPack();
    const nodes = pack.nodes.slice(0, 7) as ExplorerNode[];
    const board = buildBoard(
      { id: "b", name: "Board", hint: "", color: "#fff" },
      nodes,
      () => "all",
    );
    expect(board.count).toBe(7);
    for (const node of nodes) {
      expect(node.lx).toBeTypeOf("number");
      expect(node.lz).toBeTypeOf("number");
    }
    expect(board.w).toBeGreaterThan(0);
    expect(board.d).toBeGreaterThan(0);
  });
});

describe("layoutDomains", () => {
  it("creates boards for domains with three or more nodes plus a shared bucket", () => {
    const pack = freshPack();
    const boards = layoutDomains(pack, [...pack.nodes]);
    const counts: Record<string, number> = {};
    for (const node of pack.nodes) {
      counts[node.domain] = (counts[node.domain] ?? 0) + 1;
    }
    const majors = Object.values(counts).filter((count) => count >= 3).length;
    const hasRest = Object.values(counts).some((count) => count < 3);
    expect(boards.length).toBe(majors + (hasRest ? 1 : 0));
    if (hasRest) {
      expect(boards.at(-1)?.id).toBe("dom:shared");
      expect(boards.at(-1)?.name).toBe("Shared / other");
    }
    for (const board of boards) expect(board.y).toBe(0);
  });
});

describe("layoutDeploy", () => {
  it("creates one board per populated trust zone", () => {
    const pack = freshPack();
    const boards = layoutDeploy(pack, [...pack.nodes]);
    const populated = pack.hosts.filter((host) =>
      pack.nodes.some((node) => node.host === host.id),
    );
    expect(boards.length).toBe(populated.length);
    for (const board of boards) {
      expect(board.id.startsWith("host:")).toBe(true);
    }
  });
});

describe("layoutLayers", () => {
  it("stacks aligned boards top-down with a shared footprint", () => {
    const pack = freshPack();
    const boards = layoutLayers(pack, [...pack.nodes]);
    expect(boards.length).toBeGreaterThan(1);
    const widths = new Set(boards.map((board) => board.w));
    const depths = new Set(boards.map((board) => board.d));
    expect(widths.size).toBe(1);
    expect(depths.size).toBe(1);
    const sorted = [...boards].sort(
      (a, b) => (b.layerZ ?? 0) - (a.layerZ ?? 0),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.y).toBeGreaterThan(sorted[i]!.y);
    }
    for (const board of boards) {
      expect(board.x).toBe(0);
      expect(board.z).toBe(0);
    }
  });
});

describe("layoutView", () => {
  it("dispatches to the mode-specific layout", () => {
    const pack = freshPack();
    expect(
      layoutView("domains", pack, [...pack.nodes])[0]?.id.startsWith("dom:"),
    ).toBe(true);
    expect(
      layoutView("deploy", pack, [...pack.nodes])[0]?.id.startsWith("host:"),
    ).toBe(true);
    expect(
      layoutView("layers", pack, [...pack.nodes])[0]?.id.startsWith("layer:"),
    ).toBe(true);
  });
});
