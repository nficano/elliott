/**
 * Eval harness + footprint-gate runner (§11/§21). Datasets are supplied by
 * consumers. The static footprint gate is the free per-PR gate; the eval harness
 * is the paid nightly gate.
 */
export { compareRuns, runDataset, sampleToolSubset } from "./eval.js";
export { lintSchema, reportGate, runFootprintGate } from "./footprint-gate.js";
export type {
  FootprintGateOptions,
  FootprintGateReport,
  GoldenItem,
  RunDelta,
  RunFn,
  RunMetrics,
  SchemaLint,
} from "./types.js";
