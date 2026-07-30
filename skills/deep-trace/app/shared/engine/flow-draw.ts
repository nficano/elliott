import type { Scene } from "./scene";
import type { EngineState } from "./state";

import { point } from "../utils/camera";
import { CANVAS_COLOR } from "../utils/palette";
import { edgeCurve, newCurve } from "./edges";
import { qPoint } from "./scene";

const curve = newCurve();
const scratch = point();

export interface FlowFrameResult {
  readonly finishedLastStep: boolean;
  readonly advance: boolean;
  readonly progress: number;
}

// Advance the flow clock; report whether to advance a step or park at the
// end. Kept separate from drawing so the player logic is unit-testable.
export const stepFlowClock = (
  state: EngineState,
  dt: number,
): FlowFrameResult => {
  const flow = state.flow;
  if (!flow) return { finishedLastStep: false, advance: false, progress: 0 };
  if (state.flowPlaying) state.flowT += dt * 0.55;
  if (state.flowT >= 1.25) {
    if (state.flowStep === flow.steps.length - 1) {
      state.flowT = 1;
      state.flowPlaying = false;
      return { finishedLastStep: true, advance: false, progress: 1 };
    }
    return { finishedLastStep: false, advance: true, progress: 1 };
  }
  const t = Math.min(1, state.flowT);
  return {
    finishedLastStep: false,
    advance: false,
    progress: (state.flowStep + t) / flow.steps.length,
  };
};

const smooth = (t: number): number =>
  t < 0 ? 0 : (t > 1 ? 1 : t * t * (3 - 2 * t));

// Draw the dashed path and comet for the active flow step.
export const drawFlow = (scene: Scene, state: EngineState): void => {
  const flow = state.flow;
  if (!flow) return;
  const step = flow.steps[state.flowStep];
  if (!step) return;
  const a = state.nodesById.get(step.from);
  const b = state.nodesById.get(step.to);
  if (!a || !b || a === b) return;
  const { ctx } = scene;
  const t = Math.min(1, state.flowT);
  edgeCurve(scene, state, { from: a.id, to: b.id }, curve);
  ctx.save();
  ctx.strokeStyle = CANVAS_COLOR.accent;
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([3, 7]);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = CANVAS_COLOR.accent;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(curve.a.x, curve.a.y);
  ctx.quadraticCurveTo(curve.c.x, curve.c.y, curve.b.x, curve.b.y);
  ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 7; i++) {
    const tt = smooth(t) - i * 0.035;
    if (tt < 0) continue;
    qPoint(curve.a, curve.c, curve.b, tt, scratch);
    ctx.globalAlpha = 0.85 * (1 - i / 7);
    ctx.fillStyle = i === 0 ? CANVAS_COLOR.paperBright : CANVAS_COLOR.accent;
    ctx.beginPath();
    ctx.arc(scratch.x, scratch.y, i === 0 ? 5.5 : 4 - i * 0.4, 0, 7);
    ctx.fill();
  }
  qPoint(curve.a, curve.c, curve.b, smooth(t), scratch);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = CANVAS_COLOR.accent;
  ctx.beginPath();
  ctx.arc(scratch.x, scratch.y, 13, 0, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
};
