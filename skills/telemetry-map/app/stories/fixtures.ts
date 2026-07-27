import type { ExplorerEdge, ExplorerNode } from "#shared/types/explorer";
import type { RawTopology } from "#shared/types/topology";

import { createEngineState } from "#shared/engine/state";
import { buildExplorerPack } from "#shared/utils/explorer-pack";

import { useExplorer } from "~/composables/useExplorer";

// A miniature verified-topology excerpt: enough structure for the drawer,
// tooltip, and flow player to render every section they support.
export const FIXTURE_TOPOLOGY: RawTopology = {
  version: "story-fixture",
  title: "Elliott Runtime — Story Fixture",
  runtimeLegend: { live: "Wired and active at runtime." },
  domains: [
    {
      id: "agent-core",
      title: "Agent Core",
      purpose: "Conversation control.",
      trustBoundary: "In-process runtime logic.",
    },
    {
      id: "model-inference",
      title: "Model Inference",
      purpose: "Route attestation and completion.",
      trustBoundary: "Egress via loopback proxy.",
    },
  ],
  nodes: [
    {
      id: "runtime.agentLoop",
      name: "Agent loop — bounded tool rounds",
      kind: "runtime",
      domain: "agent-core",
      runtime: "live",
      source: "src/runtime/agent.ts",
      interface: "RuntimeAgent.turn",
      characteristics: [
        "Runs the bounded round loop for each turn.",
        "Single seam between gateways, model, and tools.",
        "Emits telemetry for observability.",
      ],
      classifications: {
        trustZone: "trusted-core",
        criticality: "core",
        dataClassification: "conversation content",
        failureMode: "Turn fails closed with a reported error.",
      },
    },
    {
      id: "runtime.modelClient",
      name: "Model client",
      kind: "runtime",
      domain: "model-inference",
      runtime: "live",
      source: "src/runtime/model/client.ts",
      interface: "ModelClient.complete",
      characteristics: ["Sends completion requests."],
      classifications: {
        trustZone: "trusted-core",
        criticality: "core",
      },
    },
    {
      id: "database.sessions",
      name: "SQLite sessions store",
      kind: "database",
      domain: "agent-core",
      runtime: "live",
      source: "src/runtime/model/store.ts",
      tables: ["runs", "messages"],
      classifications: {
        trustZone: "trusted-core",
        criticality: "supporting",
        dataClassification: "conversation content / pii",
      },
    },
  ],
  edges: [
    {
      id: "e.loop.model",
      from: "runtime.agentLoop",
      to: "runtime.modelClient",
      kind: "control",
      label: "Request model completion",
      protocol: "in-process",
      routing: "RuntimeAgent.turn -> ModelClient.complete",
      carries: "messages / tools",
      security: "internal",
      contract: {
        direction: "request-response",
        delivery: "at-most-once",
        errorHandling: "Turn fails closed and reports the error.",
      },
      activation: "every turn",
    },
    {
      id: "e.loop.store",
      from: "runtime.agentLoop",
      to: "database.sessions",
      kind: "persist",
      label: "Persist turn evidence",
      protocol: "sqlite",
      carries: "runs, messages",
      security: "internal / pii",
      contract: { direction: "write", delivery: "transactional" },
      activation: "every turn",
    },
  ],
};

export const fixturePack = () => buildExplorerPack(FIXTURE_TOPOLOGY);

// Load the fixture pack into the explorer store so drawer/tooltip stories can
// resolve node names and edge styles exactly like the app does.
export const withFixtureStore = () => {
  const explorer = useExplorer();
  const pack = fixturePack();
  explorer.engineState.value = createEngineState(pack);
  explorer.pack.value = pack;
  return { explorer, pack };
};

export const fixtureNode = (pack = fixturePack()): ExplorerNode => {
  const node = pack.nodes.find((item) => item.id === "runtime.agentLoop");
  if (!node) throw new Error("fixture node missing");
  return node;
};

export const fixtureEdge = (pack = fixturePack()): ExplorerEdge => {
  const edge = pack.edges.find((item) => item.id === "e.loop.model");
  if (!edge) throw new Error("fixture edge missing");
  return edge;
};
