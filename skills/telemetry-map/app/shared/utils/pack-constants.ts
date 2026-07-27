import type {
  EdgeKindStyle,
  EdgeMotion,
  HostZone,
  Layer,
} from "../types/explorer";

// Every constant here is a 1:1 transcription of the legacy pack builder, so
// the rewrite renders the same boards, labels, motion, and styles.

export const ACTIVE_PACK_ID = "elliott-runtime";

export const LAYER_BY_DOMAIN: Readonly<Record<string, string>> = {
  "secrets": "layer:entry",
  "ingress": "layer:entry",
  "agent-core": "layer:core",
  "model-inference": "layer:model",
  "tool-execution": "layer:capability",
  "external-integrations": "layer:capability",
  "mcp-federation": "layer:capability",
  "memory-persistence": "layer:state",
  "self-evolution": "layer:evolution",
  "observability": "layer:governance",
  "kernel-governance": "layer:governance",
  "deployment-substrate": "layer:substrate",
};

export const LAYERS: readonly Layer[] = [
  {
    id: "layer:entry",
    name: "Ingress",
    purpose: "External input, secrets, and request dispatch.",
    z: 7,
  },
  {
    id: "layer:core",
    name: "Core",
    purpose: "Conversation control, prompt assembly, and tool dispatch.",
    z: 6,
  },
  {
    id: "layer:model",
    name: "Model",
    purpose: "Route attestation and model completion.",
    z: 5,
  },
  {
    id: "layer:capability",
    name: "Capabilities",
    purpose: "Local tools, network integrations, and MCP federation.",
    z: 4,
  },
  {
    id: "layer:state",
    name: "Memory",
    purpose: "Evidence, snapshots, session storage, and SQLite.",
    z: 3,
  },
  {
    id: "layer:evolution",
    name: "Evolution",
    purpose: "Signals, triage, evaluation, proposals, and control.",
    z: 2,
  },
  {
    id: "layer:governance",
    name: "Governance",
    purpose: "Telemetry, audit, reporting, and operator surfaces.",
    z: 1,
  },
  {
    id: "layer:substrate",
    name: "Substrate",
    purpose: "The Elliott, Postgres, and browser containers.",
    z: 0,
  },
];

export const HOSTS: readonly Omit<HostZone, "color">[] = [
  {
    id: "external-untrusted",
    name: "External · untrusted",
    hint: "Inbound callers and content outside the trust boundary.",
  },
  {
    id: "edge",
    name: "Edge",
    hint: "Trusted boundary code that receives or dispatches untrusted input.",
  },
  {
    id: "trusted-core",
    name: "Trusted core",
    hint: "In-process runtime logic.",
  },
  {
    id: "sandboxed",
    name: "Sandboxed",
    hint: "Capability execution constrained by containment and allowlists.",
  },
  {
    id: "egress",
    name: "Network egress",
    hint: "Providers and integrations reached outside the process.",
  },
  {
    id: "secret",
    name: "Secret boundary",
    hint: "Secret provenance and material.",
  },
  {
    id: "substrate",
    name: "Substrate",
    hint: "Containers, networks, and hosting.",
  },
];

export const HOST_BASE_COLOR: Readonly<Record<string, string>> = {
  "external-untrusted": "#cf8f8f",
  "edge": "#d38900",
  "trusted-core": "#79b98d",
  "sandboxed": "#8aa6cf",
  "egress": "#b98ac9",
  "secret": "#cf8fb5",
  "substrate": "#9a8fc4",
};

export const NODE_LABELS: Readonly<Record<string, string>> = {
  "secret.vault": "Vault",
  "gateway.slack": "Slack",
  "gateway.webhook": "Webhook",
  "runtime.http": "HTTP",
  "runtime.inbound": "Inbound",
  "runtime.agentLoop": "Agent loop",
  "runtime.prompt": "Prompt",
  "runtime.router": "Router",
  "runtime.modelClient": "Model client",
  "runtime.toolExec": "Tool runner",
  "runtime.kernel": "Kernel",
  "provider.litellm": "LiteLLM",
  "provider.ollama": "Ollama",
  "tool.files": "Files",
  "tool.terminal": "Terminal",
  "tool.ssh": "SSH",
  "tool.fetch": "Fetch",
  "tool.search": "Search",
  "tool.browser": "Browser",
  "tool.gmail": "Gmail",
  "tool.email": "Email",
  "tool.imessage": "iMessage",
  "tool.homeassistant": "Home Assistant",
  "service.scheduler": "Scheduler",
  "mcp.client": "MCP client",
  "mcp.h12o": "h12o MCP",
  "mcp.homeassistant": "HA MCP",
  "memory.sessionStore": "Sessions",
  "memory.evidence": "Evidence",
  "memory.curated": "Curated memory",
  "memory.snapshots": "Snapshots",
  "database.sessions": "SQLite",
  "learning.signals": "Signals",
  "learning.triage": "Triage",
  "learning.proposals": "Proposals",
  "learning.control": "Evolution control",
  "evaluator.gauntlet": "Evaluator",
  "evaluator.companions": "Companions",
  "obs.telemetry": "Telemetry",
  "obs.footprint": "Footprint",
  "obs.audit": "Audit",
  "obs.reporter": "GlitchTip",
  "obs.map": "Telemetry map",
  "container.elliott": "Elliott",
  "container.postgres": "Postgres",
  "container.browser": "Browserless",
};

// Qualitative motion cues preserve the particle grammar without inventing
// telemetry.
export const EDGE_MOTION: Readonly<Record<string, EdgeMotion>> = {
  data: { count: 3, speed: 0.12, size: 3.1 },
  control: { count: 2, speed: 0.1, size: 2.5 },
  persist: { count: 2, speed: 0.075, size: 2.9 },
  learn: { count: 1, speed: 0.065, size: 2.7 },
  health: { count: 1, speed: 0.055, size: 2 },
  secret: { count: 1, speed: 0.045, size: 1.8 },
};

export const DEFAULT_EDGE_MOTION: EdgeMotion = {
  count: 1,
  speed: 0.065,
  size: 2.2,
};

export const DOMAIN_PALETTE: Readonly<Record<string, string>> = {
  "secrets": "#cf8fb5",
  "ingress": "#cf8f8f",
  "agent-core": "#79b98d",
  "model-inference": "#b98ac9",
  "tool-execution": "#8aa6cf",
  "external-integrations": "#729daa",
  "mcp-federation": "#93c58a",
  "memory-persistence": "#6f9fc4",
  "self-evolution": "#cbab63",
  "observability": "#c99f6a",
  "kernel-governance": "#9a8fc4",
  "deployment-substrate": "#8894ad",
};

export const EDGE_KIND_STYLES: Readonly<Record<string, EdgeKindStyle>> = {
  data: { color: "#4d7fb0", width: 1.8, dash: false },
  control: { color: "#3f9d8f", width: 1.65, dash: true },
  persist: { color: "#4f9c67", width: 2.1, dash: false },
  learn: { color: "#cc9750", width: 1.9, dash: true },
  health: { color: "#8a8f9c", width: 1.4, dash: true },
  secret: { color: "#a07fc6", width: 1.8, dash: true },
};
