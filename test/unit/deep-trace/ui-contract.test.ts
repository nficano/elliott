import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The interaction contract of the served UI. Every element and behavior
// asserted here is exercised by the Playwright parity suite, so a rewrite
// must keep this surface identical (ids may differ only if the parity suite
// is updated in the same change).
const root = path.resolve(import.meta.dir, "../../..");
const uiPath = path.join(root, "skills/deep-trace/src/ui.html");

const source = { html: "" };

beforeAll(async () => {
  source.html = await readFile(uiPath, "utf8");
});

describe("deep-trace UI document", () => {
  it("is a standalone HTML document with the explorer title", () => {
    expect(source.html).toStartWith("<!DOCTYPE html>");
    expect(source.html).toContain(
      "<title>Elliott Stack Explorer — Runtime Topology</title>",
    );
  });

  it("loads its fonts and topology through the extension routes", () => {
    expect(source.html).toContain("/v1/observability/map/font/display");
    expect(source.html).toContain("/v1/observability/map/font/body");
    expect(source.html).toContain("`${BASE}/topology`");
    expect(source.html).toContain("elliott-topology.enriched.json");
  });
});

describe("deep-trace UI interaction surface", () => {
  it("renders the isometric scene on an accessible canvas", () => {
    expect(source.html).toContain("<canvas id=\"scene\"");
    expect(source.html).toMatch(
      /<canvas id="scene" role="img" aria-label="[^"]+"/,
    );
  });

  it("offers exactly the three view modes", () => {
    expect(source.html).toContain("data-view=\"domains\"");
    expect(source.html).toContain("data-view=\"deploy\"");
    expect(source.html).toContain("data-view=\"layers\"");
  });

  it("ships the Ask Elliott send panel wired to the send route", () => {
    expect(source.html).toContain("id=\"sendForm\"");
    expect(source.html).toContain("id=\"sendInput\"");
    expect(source.html).toContain("id=\"sendBtn\"");
    expect(source.html).toContain("id=\"sendHint\"");
    expect(source.html).toContain("id=\"sendResponse\"");
    expect(source.html).toContain("`${BASE}/send`");
    expect(source.html).toContain("flow:map-message");
  });

  it("ships the edge brightness preset slider with three stops", () => {
    expect(source.html).toContain("id=\"edgeBrightness\"");
    expect(source.html).toContain("id=\"edgeBrightnessValue\"");
    expect(source.html).toContain("id=\"edgeBrightnessHint\"");
    for (const preset of ["off", "dim", "bright"]) {
      expect(source.html.toLowerCase()).toContain(`"${preset}"`);
    }
  });

  it("ships zoom, rotate, and reset navigation controls", () => {
    for (const id of ["zin", "zout", "zfit", "rotL", "rotR"]) {
      expect(source.html).toContain(`id="${id}"`);
    }
  });

  it("ships the hover tooltip and the detail drawer", () => {
    expect(source.html).toContain("id=\"tooltip\"");
    expect(source.html).toContain("id=\"drawer\"");
    expect(source.html).toContain("id=\"drawerClose\"");
    expect(source.html).toContain("id=\"drawerBody\"");
  });

  it("ships the flow player with transport controls", () => {
    for (const id of ["flowPlayer", "fpPlay", "fpNext", "fpPrev", "fpExit"]) {
      expect(source.html).toContain(`id="${id}"`);
    }
  });

  it("keeps the drawer and flow player inert until opened", () => {
    expect(source.html).toMatch(/id="drawer"[^>]*aria-hidden="true"[^>]*inert/);
    expect(source.html).toMatch(
      /id="flowPlayer"[^>]*aria-hidden="true"[^>]*inert/,
    );
  });

  it("documents the pointer gesture vocabulary in the hint bar", () => {
    expect(source.html).toContain("id=\"hint\"");
    for (const gesture of ["Drag", "Scroll", "Click", "Esc"]) {
      expect(source.html).toContain(gesture);
    }
  });

  it("exposes the parsed explorer pack for debugging and tests", () => {
    expect(source.html).toContain("window.ELLIOTT_EXPLORER_DATA");
  });

  it("honours reduced-motion preferences", () => {
    expect(source.html).toContain("prefers-reduced-motion");
  });

  it("binds the keyboard shortcuts the parity suite exercises", () => {
    for (const key of ["\"Escape\"", "\"ArrowLeft\"", "\"ArrowRight\""]) {
      expect(source.html).toContain(`case ${key}`);
    }
    expect(source.html).toContain("e.metaKey||e.ctrlKey");
  });
});
