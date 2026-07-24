import path from "node:path";
import { AgentKernel } from "../kernel";

export const makeRuntimeKernel = (root: string): AgentKernel =>
  new AgentKernel({
    posture: "standard",
    snapshotDirectory: path.join(root, ".elliott-runtime", "snapshots"),
  });
