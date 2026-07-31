import type { Page } from "@playwright/test";

import { expect, test } from "@playwright/test";

// Shared scenarios run against BOTH implementations. Send/replay behavior
// intentionally diverges: the legacy UI plays the scripted explainer flow,
// the rewrite animates live telemetry and offers recorded replays — each has
// its own suite below the shared loop.
const BASE = "/v1/deeptrace";

const TARGETS = [
  { name: "legacy", path: `${BASE}/legacy` },
  { name: "rewrite", path: `${BASE}` },
] as const;

interface CamHandle {
  tZoom: number;
  tAz: number;
  tTilt: number;
}

const cam = (page: Page): Promise<CamHandle> =>
  page.evaluate(() => {
    const value = (globalThis as unknown as { __cam: CamHandle; }).__cam;
    return { tZoom: value.tZoom, tAz: value.tAz, tTilt: value.tTilt };
  });

const packSummary = (page: Page) =>
  page.evaluate(() => {
    const data = (globalThis as unknown as {
      ELLIOTT_EXPLORER_DATA?: {
        nodes: { id: string; }[];
        edges: unknown[];
        flows: { id: string; steps: unknown[]; }[];
      };
    }).ELLIOTT_EXPLORER_DATA;
    if (!data) return null;
    return {
      nodes: data.nodes.length,
      edges: data.edges.length,
      flowIds: data.flows.map((flow) => flow.id),
    };
  });

const nodeScreenPosition = (page: Page, nodeId: string) =>
  page.evaluate((id) => {
    const data = (globalThis as unknown as {
      ELLIOTT_EXPLORER_DATA: {
        nodes: { id: string; rs: { sx: number; sy: number; }; }[];
      };
    }).ELLIOTT_EXPLORER_DATA;
    const node = data.nodes.find((candidate) => candidate.id === id);
    return node ? { x: node.rs.sx, y: node.rs.sy } : null;
  }, nodeId);

const waitForBoot = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await expect(page.locator("#subtitle")).toContainText("rev", {
    timeout: 15_000,
  });
  await expect(page.locator("#scene")).toBeVisible();
  // Let the boot camera easing and node drop-in animation settle.
  await page.waitForTimeout(2500);
};

for (const target of TARGETS) {
  test.describe(`${target.name} explorer`, () => {
    test.beforeEach(async ({ page }) => {
      await waitForBoot(page, target.path);
    });

    test("boots with the verified topology and exposes the pack", async ({ page }) => {
      const summary = await packSummary(page);
      expect(summary).not.toBeNull();
      expect(summary!.nodes).toBeGreaterThan(30);
      expect(summary!.edges).toBeGreaterThan(40);
      expect(summary!.flowIds[0]).toBe("flow:map-message");
      expect(summary!.flowIds).toContain("flow:owner-model");
      await expect(page.locator("#subtitle")).toContainText(
        "Elliott Runtime",
      );
    });

    test("offers the three view modes and switches between them", async ({ page }) => {
      const domains = page.locator('#viewSeg [data-view="domains"]');
      const deploy = page.locator('#viewSeg [data-view="deploy"]');
      const layers = page.locator('#viewSeg [data-view="layers"]');
      await expect(domains).toHaveAttribute("aria-pressed", "true");
      const before = await cam(page);
      await layers.click();
      await expect(layers).toHaveAttribute("aria-pressed", "true");
      await expect(domains).toHaveAttribute("aria-pressed", "false");
      await page.waitForTimeout(400);
      const after = await cam(page);
      expect(after.tAz).not.toBeCloseTo(before.tAz, 3);
      await deploy.click();
      await expect(deploy).toHaveAttribute("aria-pressed", "true");
    });

    test("edge brightness slider walks Off / Dim / Bright with hints", async ({ page }) => {
      const slider = page.locator("#edgeBrightness");
      const output = page.locator("#edgeBrightnessValue");
      const hint = page.locator("#edgeBrightnessHint");
      await expect(output).toHaveText("Dim");
      await slider.fill("0");
      await expect(output).toHaveText("Off");
      await expect(hint).toContainText("hidden");
      await slider.fill("2");
      await expect(output).toHaveText("Bright");
      await expect(hint).toContainText("full brightness");
      await slider.fill("1");
      await expect(output).toHaveText("Dim");
    });

    test("zoom and reset controls steer the camera", async ({ page }) => {
      const before = await cam(page);
      await page.locator("#zin").click();
      const zoomed = await cam(page);
      expect(zoomed.tZoom).toBeGreaterThan(before.tZoom);
      await page.locator("#zout").click();
      await page.locator("#zout").click();
      const shrunk = await cam(page);
      expect(shrunk.tZoom).toBeLessThan(zoomed.tZoom);
      await page.locator("#zfit").click();
      await page.locator("#rotL").click();
      const rotated = await cam(page);
      expect(rotated.tAz).not.toBeCloseTo(zoomed.tAz, 3);
    });

    test("keyboard zooms and Escape leaves form fields", async ({ page }) => {
      const before = await cam(page);
      await page.keyboard.press("+");
      const zoomed = await cam(page);
      expect(zoomed.tZoom).toBeGreaterThan(before.tZoom);
      const input = page.locator("#sendInput");
      await input.click();
      await expect(input).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(input).not.toBeFocused();
    });

    test("rejects an empty message with inline validation", async ({ page }) => {
      await page.locator("#sendBtn").click();
      await expect(page.locator("#sendHint")).toContainText(
        "Write a message before sending.",
      );
      await expect(page.locator("#sendInput")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await page.locator("#sendInput").fill("x");
      await expect(page.locator("#sendInput")).toHaveAttribute(
        "aria-invalid",
        "false",
      );
    });

    test("clicking a node opens its detail drawer; Escape closes it", async ({ page }) => {
      const at = await nodeScreenPosition(page, "runtime.agentLoop");
      expect(at).not.toBeNull();
      await page.mouse.click(at!.x, at!.y);
      const drawer = page.locator("#drawer");
      await expect(drawer).toHaveClass(/open/);
      await expect(page.locator("#dName")).toHaveText("Agent loop");
      await expect(page.locator("#dId")).toHaveText("runtime.agentLoop");
      await expect(page.locator("#drawerBody .edgeitem").first())
        .toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toHaveClass(/open/);
    });

    test("drawer connection rows pivot to the edge detail view", async ({ page }) => {
      const at = await nodeScreenPosition(page, "runtime.agentLoop");
      await page.mouse.click(at!.x, at!.y);
      await expect(page.locator("#drawer")).toHaveClass(/open/);
      await page.locator("#drawerBody .edgeitem").first().click();
      await expect(page.locator("#dName")).toContainText("→");
      await expect(page.locator("#drawerBody")).toContainText("Protocol");
    });

    test("hovering a node shows the delayed tooltip", async ({ page }) => {
      const at = await nodeScreenPosition(page, "runtime.agentLoop");
      await page.mouse.move(at!.x, at!.y);
      await page.waitForTimeout(1200);
      const tooltip = page.locator("#tooltip");
      await expect(tooltip).toHaveClass(/show/);
      await expect(tooltip.locator(".t-name")).toHaveText("Agent loop");
    });
  });
}

test.describe("legacy explorer · scripted send flow", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoot(page, `${BASE}/legacy`);
  });

  test("send starts the explainer flow and renders the answer", async ({ page }) => {
    await page.locator("#sendInput").fill("hello from playwright");
    await page.locator("#sendBtn").click();
    await expect(page.locator("#flowPlayer")).toHaveClass(/show/);
    await expect(page.locator("#fpTitle")).toHaveText("Map message → Elliott");
    await expect(page.locator("#fpStep")).toContainText("/10");
    await expect(page.locator("#edgeBrightness")).toBeDisabled();
    await expect(page.locator("#sendResponse")).toContainText(
      "echo: hello from playwright",
      { timeout: 15_000 },
    );
    await expect(page.locator("#sendBtn")).toBeEnabled();
  });

  test("flow transport controls work and exit restores presets", async ({ page }) => {
    await page.locator("#sendInput").fill("trace");
    await page.locator("#sendBtn").click();
    await expect(page.locator("#flowPlayer")).toHaveClass(/show/);
    await page.locator("#fpStep").hover();
    await expect(page.locator("#fpPlay")).toHaveText("▶");
    const stepText = await page.locator("#fpStep").textContent();
    await page.locator("#fpNext").click();
    await expect(page.locator("#fpStep")).not.toHaveText(stepText ?? "");
    await page.locator("#fpExit").click();
    await expect(page.locator("#flowPlayer")).not.toHaveClass(/show/);
    await expect(page.locator("#edgeBrightness")).toBeEnabled();
  });

  test("Escape exits an active flow", async ({ page }) => {
    await page.locator("#sendInput").fill("trace");
    await page.locator("#sendBtn").click();
    await expect(page.locator("#flowPlayer")).toHaveClass(/show/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#flowPlayer")).not.toHaveClass(/show/);
  });
});

test.describe("rewrite explorer · real-time send and replay", () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoot(page, BASE);
  });

  const send = async (page: Page, text: string): Promise<void> => {
    await page.locator("#sendInput").fill(text);
    await page.locator("#sendBtn").click();
    await expect(page.locator("#sendResponse")).toContainText(
      `echo: ${text}`,
      { timeout: 15_000 },
    );
  };

  test("send stays real-time: answer arrives with no explainer flow", async ({ page }) => {
    await send(page, "realtime check");
    await expect(page.locator("#flowPlayer")).not.toHaveClass(/show/);
    await expect(page.locator("#edgeBrightness")).toBeEnabled();
    await expect(page.locator("#sendHint")).toContainText("Answered");
    await expect(page.locator("#sendInput")).toHaveValue("");
  });

  test("invocations list records the query, clamped to two lines", async ({ page }) => {
    const longText =
      "please summarize everything that happened across the runtime today "
      + "including every tool call, every model round, and every database "
      + "write in exhaustive detail";
    await send(page, longText);
    const item = page.locator("#invocationList .invocation").first();
    await expect(item).toContainText("please summarize");
    const clamped = await item.locator("span").first().evaluate((el) =>
      getComputedStyle(el).webkitLineClamp
    );
    expect(clamped).toBe("2");
  });

  test("clicking an invocation replays it with the trace inspector", async ({ page }) => {
    await send(page, "replay me");
    await page.locator("#invocationList .invocation").first().click();
    await expect(page.locator("#flowPlayer")).toHaveClass(/show/);
    await expect(page.locator("#fpTitle")).toContainText("Replay · replay me");
    const drawer = page.locator("#drawer");
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer).toHaveAttribute("data-kind", "trace");
    await expect(page.locator("#dName")).toHaveText("Inbound message");
    await expect(page.locator("#traceBody")).toContainText("replay me");
    // Stepping advances the inspector like a debugger.
    await page.locator("#fpNext").click();
    await expect(page.locator("#dName")).toHaveText("Inbound dispatch");
    await page.locator("#fpNext").click();
    await expect(page.locator("#dName")).toHaveText("Turn opened");
    // Raw toggle shows the recorded JSON event.
    await page.locator("#traceRawToggle").click();
    await expect(page.locator("#traceBody pre")).toContainText("turn.begin");
    await page.locator("#traceRawToggle").click();
    // The last step returns the recorded answer.
    const total = await page.locator("#fpStep").textContent();
    const count = Number(total?.split("/")[1] ?? 0);
    for (let i = 2; i < count - 1; i += 1) {
      await page.locator("#fpNext").click();
    }
    await expect(page.locator("#dName")).toHaveText("Answer delivered");
    await expect(page.locator("#traceBody")).toContainText("echo: replay me");
    // Exit tears down both the replay and the inspector.
    await page.locator("#fpExit").click();
    await expect(page.locator("#flowPlayer")).not.toHaveClass(/show/);
    await expect(drawer).not.toHaveClass(/open/);
  });

  test("Escape exits a replay", async ({ page }) => {
    await send(page, "escape me");
    await page.locator("#invocationList .invocation").first().click();
    await expect(page.locator("#flowPlayer")).toHaveClass(/show/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#flowPlayer")).not.toHaveClass(/show/);
    await expect(page.locator("#drawer")).not.toHaveClass(/open/);
  });
});
