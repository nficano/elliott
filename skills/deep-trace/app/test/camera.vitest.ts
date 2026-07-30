import {
  applyZoom,
  BAKED_HOME,
  createCamera,
  easeCamera,
  point,
  project,
  rotateAround,
  screenToWorld,
} from "#shared/utils/camera";
import { describe, expect, it } from "vitest";

const view = { w: 1200, h: 800 };

const freshCamera = () => createCamera(BAKED_HOME.domains);

describe("project / screenToWorld", () => {
  it("round-trips a ground-plane point through the projection", () => {
    const cam = freshCamera();
    // screenToWorld inverts the *target* pose; align live pose with targets.
    cam.az = cam.tAz;
    cam.zoom = cam.tZoom;
    cam.panX = cam.tPanX;
    cam.panY = cam.tPanY;
    cam.tilt = cam.tTilt;
    const out = point();
    project(cam, view, [3, 0, -2], out);
    const world = screenToWorld(cam, view, [out.x, out.y], 0);
    expect(world.x).toBeCloseTo(3, 6);
    expect(world.z).toBeCloseTo(-2, 6);
  });

  it("projects higher world points to smaller screen y", () => {
    const cam = freshCamera();
    const ground = point();
    const raised = point();
    project(cam, view, [0, 0, 0], ground);
    project(cam, view, [0, 2, 0], raised);
    expect(raised.y).toBeLessThan(ground.y);
  });
});

describe("applyZoom", () => {
  it("multiplies the target zoom and clamps to [0.22, 3.6]", () => {
    const cam = freshCamera();
    applyZoom(cam, view, 1.35);
    expect(cam.tZoom).toBeCloseTo(1.35, 6);
    applyZoom(cam, view, 100);
    expect(cam.tZoom).toBe(3.6);
    applyZoom(cam, view, 0.0001);
    expect(cam.tZoom).toBe(0.22);
  });

  it("keeps the anchored screen point over the same world point", () => {
    const cam = freshCamera();
    cam.az = cam.tAz;
    const anchor: [number, number] = [900, 300];
    const before = screenToWorld(cam, view, anchor, 0);
    applyZoom(cam, view, 1.8, anchor);
    const after = screenToWorld(cam, view, anchor, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });
});

describe("rotateAround", () => {
  it("changes the azimuth by the requested delta", () => {
    const cam = freshCamera();
    const before = cam.tAz;
    rotateAround(cam, view, {
      dAz: Math.PI / 6,
      cx: view.w / 2,
      cy: view.h / 2,
      yRef: 0,
    });
    expect(cam.tAz).toBeCloseTo(before + Math.PI / 6, 9);
  });

  it("keeps the anchored world point under the anchor", () => {
    const cam = freshCamera();
    const anchor: [number, number] = [700, 500];
    const before = screenToWorld(cam, view, anchor, 0);
    rotateAround(cam, view, { dAz: 0.4, cx: anchor[0], cy: anchor[1], yRef: 0 });
    const after = screenToWorld(cam, view, anchor, 0);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.z).toBeCloseTo(before.z, 5);
  });

  it("snap commits the live pose immediately", () => {
    const cam = freshCamera();
    rotateAround(cam, view, {
      dAz: 0.2,
      cx: 10,
      cy: 10,
      yRef: 0,
      snap: true,
    });
    expect(cam.az).toBe(cam.tAz);
    expect(cam.panX).toBe(cam.tPanX);
    expect(cam.panY).toBe(cam.tPanY);
  });
});

describe("easeCamera", () => {
  it("converges the live pose toward the targets", () => {
    const cam = freshCamera();
    cam.tZoom = 2;
    cam.tPanX = 100;
    for (let i = 0; i < 200; i += 1) easeCamera(cam, 1 / 60);
    expect(cam.zoom).toBeCloseTo(2, 3);
    expect(cam.panX).toBeCloseTo(100, 2);
  });
});
