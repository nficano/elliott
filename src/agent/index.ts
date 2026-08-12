import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CapabilityRequest, ComponentRef } from "../core/types";
import { profileWithinCeiling } from "../model/profile";
import {
  GITIGNORE,
  personaMarkdown,
  RUNTIME_CONFIG_YAML,
  RUNTIME_SECRETS_YAML,
  runtimeAgentYaml,
  runtimeMain,
} from "./runtime-template";
import type {
  AgentComponentResolver,
  AgentComposition,
  ComposedAgent,
  ComposedAgentChild,
  ConsumerScaffoldRequest,
  ConsumerScaffoldResult,
} from "./types";

const MAX_AGENT_NAME_LENGTH = 64;
const AGENT_NAME_CHARACTERS = new Set(
  "abcdefghijklmnopqrstuvwxyz0123456789-",
);

const validAgentName = (value: string): boolean =>
  value.length > 0
  && value.length <= MAX_AGENT_NAME_LENGTH
  && !value.startsWith("-")
  && !value.endsWith("-")
  && [...value].every((character) => AGENT_NAME_CHARACTERS.has(character));

const narrowCapability = (
  ceiling: ReadonlySet<string>,
  request: CapabilityRequest,
): CapabilityRequest | undefined => {
  if (ceiling.has(request.capability)) return request;
  const resources = request.resources.filter((resource) =>
    ceiling.has(`${request.capability}:${resource}`)
  );
  if (resources.length === 0) return undefined;
  return request.deferred === undefined
    ? { capability: request.capability, resources }
    : { capability: request.capability, resources, deferred: request.deferred };
};

const allRefs = (config: AgentComposition): readonly ComponentRef[] => [
  config.interactionProfile,
  ...config.skills,
  config.memory.curated,
  config.memory.sessions,
  ...(config.memory.external === undefined ? [] : [config.memory.external]),
  ...config.gateways,
  ...config.mcp,
  ...config.policies,
  ...config.evaluators,
];

export class AgentComposer {
  readonly #resolver: AgentComponentResolver;

  constructor(resolver: AgentComponentResolver) {
    this.#resolver = resolver;
  }

  compose(config: AgentComposition): ComposedAgent {
    if (
      !profileWithinCeiling(
        config.models.defaultProfile,
        config.models.maximumProfile,
      )
    ) {
      throw new Error("Agent default profile exceeds its maximum profile");
    }
    if (config.learning.mode !== "proposals" || config.learning.autoApply) {
      throw new Error("Agent learning must use non-auto-applied Proposals");
    }
    const ceiling = new Set(config.capabilityCeiling);
    const children = allRefs(config).map((ref): ComposedAgentChild => {
      const manifest = this.#resolver.resolveManifest(ref);
      if (manifest === undefined) {
        throw new Error(`Unresolved agent child ${ref}`);
      }
      return Object.freeze({
        manifest,
        effectiveCapabilities: Object.freeze(
          manifest.requestedCapabilities
            .map((request) => narrowCapability(ceiling, request))
            .filter((request) => request !== undefined),
        ),
      });
    });
    return Object.freeze({
      config,
      children: Object.freeze(children),
      loop: "default",
    });
  }
}

const agentYaml = (name: string): string =>
  `apiVersion: elliott/v1
kind: agent
metadata: { namespace: local, name: ${name}, version: 0.1.0 }
spec:
  interactionProfile: { ref: builtin/interaction-profile/default }
  models: { defaultProfile: balanced, maximumProfile: deep }
  skills: []
  memory:
    curated: { ref: builtin/memory/curated }
    sessions: { ref: builtin/memory/session-store }
  gateways: []
  mcp: []
  policies: [builtin/policy/default]
  evaluators: []
  capabilityCeiling: []
  learning: { mode: proposals, autoApply: false }
`;

const CONSUMER_TEST = `import { describe, expect, it } from "bun:test";
import { MemoryRecordAppender, principalId, snapshotId } from "elliott/core";
import { AgentTurnLoop } from "elliott/loop";

describe("consumer agent", () => {
  it("runs a turn end to end", async () => {
    const records = new MemoryRecordAppender();
    const snapshot = snapshotId("consumer-snapshot");
    const loop = new AgentTurnLoop({
      hasSnapshot: (candidate) => candidate === snapshot,
      dispatcher: {
        async infer() { return { text: "ready", toolCalls: [] }; },
      },
      broker: {
        async execute() { throw new Error("No tools requested"); },
      },
      records,
    });
    const result = await loop.run({
      inbound: {
        id: "consumer-message",
        principal: principalId("consumer"),
        actorTrust: "authenticated",
        contentTrust: "trusted",
        classification: "internal",
        securityTags: [],
        payload: "hello",
        createdAt: new Date().toISOString(),
      },
      snapshot,
      segments: [],
    });
    expect(result.type).toBe("respond");
  });
});
`;

const scaffoldContent = (
  name: string,
): readonly (readonly [string, string])[] => [
  ["agent.yaml", agentYaml(name)],
  ["AGENTS.md", `# ${name}\n`],
  [
    "package.json",
    `${
      JSON.stringify(
        {
          name,
          private: true,
          type: "module",
          scripts: { start: "bun main.ts", test: "bun test" },
          dependencies: { elliott: "latest" },
        },
        null,
        2,
      )
    }\n`,
  ],
  ["main.ts", runtimeMain(name)],
  [".gitignore", GITIGNORE],
  [path.join("agents", name, "agent.yaml"), runtimeAgentYaml(name)],
  [path.join("assets", "prompts", `${name}.md`), personaMarkdown(name)],
  [path.join("config", "elliott.yaml"), RUNTIME_CONFIG_YAML],
  [path.join("config", "secrets.yaml"), RUNTIME_SECRETS_YAML],
  [".elliott/models.yaml", "profiles: {}\n"],
  [".elliott/policy.yaml", "capabilities: []\n"],
  [".elliott/posture.yaml", "posture: standard\n"],
  [".elliott/lock.yaml", "resolutions: []\nshadowing: []\n"],
  [".elliott/tests/agent.test.ts", CONSUMER_TEST],
];

export const scaffoldConsumerAgent = async (
  request: ConsumerScaffoldRequest,
): Promise<ConsumerScaffoldResult> => {
  if (!validAgentName(request.name)) {
    throw new Error("Agent name must be lowercase kebab-case");
  }
  const directory = path.resolve(request.parentDirectory, request.name);
  const elliott = path.join(directory, ".elliott");
  await Promise.all([
    mkdir(path.join(directory, "agents", request.name, "skills"), {
      recursive: true,
    }),
    mkdir(path.join(directory, "assets", "prompts"), { recursive: true }),
    mkdir(path.join(directory, "config"), { recursive: true }),
    mkdir(path.join(elliott, "components"), { recursive: true }),
    mkdir(path.join(elliott, "tests"), { recursive: true }),
  ]);
  const content = scaffoldContent(request.name);
  const files = content.map(([name]) => path.join(directory, name));
  await Promise.all(
    content.map(([name, value]) =>
      writeFile(path.join(directory, name), value, { flag: "wx" })
    ),
  );
  return Object.freeze({ directory, files: Object.freeze(files) });
};

export type * from "./types";
