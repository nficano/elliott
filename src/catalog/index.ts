import { egressClass } from "../placement/egress";
import type { BundledComponentDescriptor } from "./types";

export { loadAgentSkillPackages, loadBundledPackages } from "./bundled";
export {
  assertBrokeredDestination,
  assertWorkspacePath,
  stripActiveContent,
} from "./guards";

const descriptor = (
  input: BundledComponentDescriptor,
): BundledComponentDescriptor => Object.freeze(input);

export const BUNDLED_CATALOG: readonly BundledComponentDescriptor[] = Object
  .freeze([
    descriptor({
      name: "mcp-client",
      kind: "mcp-endpoint",
      protocols: ["tool.executor", "resource.reader", "prompt.source"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "scheduler",
      kind: "scheduler",
      protocols: ["scheduler"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: false,
    }),
    descriptor({
      name: "evaluator-dspy",
      kind: "evaluator",
      protocols: ["optimization.engine", "evaluation.runner"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "evaluator-darwinian",
      kind: "evaluator",
      protocols: ["optimization.engine"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "evaluator-agent-benchmarks",
      kind: "evaluator",
      protocols: ["benchmark.runner"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "files",
      kind: "tool",
      protocols: ["resource.reader", "resource.writer"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "terminal",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "ssh",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: ["secret://tools/ssh/private-key"],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "fetch",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "deep-trace",
      kind: "extension",
      protocols: ["health.checker"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: false,
    }),
  ]);

export type * from "./types";
