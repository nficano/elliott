import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { AgentKitConfig } from "../config/schema.js";
import {
  checkProvides,
  recordProviders,
  recordShadowed,
  resolveSecrets,
} from "./index-validation.js";
import { highestSatisfying } from "./semver.js";
import type {
  GroupOptions,
  IndexedEntry,
  Manifest,
  Registrable,
  RegistryDeps,
  RegistryIndexState,
} from "./types.js";
import { formatIssues } from "./validation.js";

export function indexRegistrables(
  registrables: Registrable[],
  deps: RegistryDeps,
  state: RegistryIndexState,
): void {
  for (const [id, group] of groupById(registrables)) {
    indexGroup({ id, group, deps, state });
  }
}

function groupById(registrables: Registrable[]): Map<string, Registrable[]> {
  const groups = new Map<string, Registrable[]>();
  for (const registrable of registrables) {
    const group = groups.get(registrable.manifest.id) ?? [];
    group.push(registrable);
    groups.set(registrable.manifest.id, group);
  }
  return groups;
}

function indexGroup(options: GroupOptions): void {
  const { id, group, deps, state } = options;
  const block = configBlock(deps, group[0]!.manifest) ?? {};
  const range = typeof block.version === "string" ? block.version : "*";
  const winnerVersion = highestSatisfying(
    group.map((registrable) => registrable.manifest.version),
    range,
  );
  const winner = group.find(
    (registrable) => registrable.manifest.version === winnerVersion,
  );
  recordShadowed({ id, group, winner, shadowed: state.shadowed });
  if (!winner) {
    disable({
      registrable: group[0]!,
      block,
      why: `no version of [${
        group.map((item) => item.manifest.version).join(", ")
      }] satisfies '${range}'`,
      deps,
      entries: state.entries,
    });
    return;
  }
  indexWinner({ winner, block, deps, state });
}

function indexWinner(options: {
  readonly winner: Registrable;
  readonly block: Record<string, unknown>;
  readonly deps: RegistryDeps;
  readonly state: RegistryIndexState;
}): void {
  const { winner, block, deps, state } = options;
  const manifest = winner.manifest;
  const isEnabled = block.enabled === true;
  const parsed = Schema.decodeUnknownResult(manifest.configSchema)(block);
  if (Result.isFailure(parsed) && isEnabled) {
    disable({
      registrable: winner,
      block,
      why: `config invalid: ${formatIssues(parsed.failure)}`,
      deps,
      entries: state.entries,
    });
    return;
  }
  const config = Result.isSuccess(parsed) && isRecord(parsed.success)
    ? parsed.success
    : block;
  if (!isEnabled) {
    setEntry({
      entries: state.entries,
      registrable: winner,
      config,
      enabled: false,
      secrets: {},
    });
    return;
  }
  enableWinner({ winner, block, config, deps, state });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enableWinner(options: {
  readonly winner: Registrable;
  readonly block: Record<string, unknown>;
  readonly config: Record<string, unknown>;
  readonly deps: RegistryDeps;
  readonly state: RegistryIndexState;
}): void {
  const { winner, block, config, deps, state } = options;
  const secrets = resolveSecrets(winner.manifest, block);
  if (!secrets.ok) {
    disable({
      registrable: winner,
      block,
      why: secrets.why,
      deps,
      entries: state.entries,
    });
    return;
  }
  const problem = checkProvides(winner.manifest, deps);
  if (problem) {
    disable({
      registrable: winner,
      block,
      why: problem,
      deps,
      entries: state.entries,
    });
    return;
  }
  recordProviders(winner.manifest, state);
  setEntry({
    entries: state.entries,
    registrable: winner,
    config,
    enabled: true,
    secrets: secrets.secrets,
  });
}

function sectionFor(kind: Manifest["kind"]): keyof AgentKitConfig {
  switch (kind) {
    case "mcp": {
      return "mcp";
    }
    case "plugin": {
      return "plugins";
    }
    case "agent": {
      return "agents";
    }
    case "channel": {
      return "channels";
    }
    default: {
      return "skills";
    }
  }
}

function configBlock(
  deps: RegistryDeps,
  manifest: Manifest,
): Record<string, unknown> | undefined {
  const section = deps.config[sectionFor(manifest.kind)] as Record<
    string,
    Record<string, unknown>
  >;
  return section?.[manifest.id];
}

function disable(options: {
  readonly registrable: Registrable;
  readonly block: Record<string, unknown>;
  readonly why: string;
  readonly deps: RegistryDeps;
  readonly entries: Map<string, IndexedEntry>;
}): void {
  const { registrable, block, why, deps, entries } = options;
  deps.obs.recordError(
    "ConfigError",
    `registrable '${registrable.manifest.id}' disabled: ${why}`,
    { "agentkit.component.id": registrable.manifest.id },
  );
  setEntry({
    entries,
    registrable,
    config: block,
    enabled: false,
    secrets: {},
  });
}

function setEntry(options: {
  readonly entries: Map<string, IndexedEntry>;
  readonly registrable: Registrable;
  readonly config: Record<string, unknown>;
  readonly enabled: boolean;
  readonly secrets: Readonly<Record<string, string>>;
}): void {
  const { entries, registrable, config, enabled, secrets } = options;
  entries.set(registrable.manifest.id, {
    registrable,
    config,
    enabled,
    secrets,
  });
}
