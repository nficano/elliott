import path from "node:path";
import { FileCommitAdapter } from "../audit/index";
import { AgentKernel } from "../kernel";

// The runtime roots the kernel at the agent checkout's state volume: snapshots,
// evolution state, durable evidence, and now the tamper-evident audit trail all
// live under .elliott-runtime so they persist across container restarts.
export const makeRuntimeKernel = (root: string): AgentKernel =>
  new AgentKernel({
    posture: "standard",
    snapshotDirectory: path.join(root, ".elliott-runtime", "snapshots"),
    auditAdapter: new FileCommitAdapter(
      path.join(root, ".elliott-runtime", "audit", "records.jsonl"),
    ),
  });
