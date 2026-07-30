// Parsing and validation of the `install:` config block and its entry grammar.

import { isJsonRecord } from "../providers/http";
import type { InstallEntry, InstallSettings } from "./types";
import { InstallError } from "./types";

const NAME = /^[a-z][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DEFAULT_REGISTRY = "nficano/skills";

// A skill name is treated as "required" (its failure flips health.ready false)
// when it is a gateway. Gateways are the agent's only way to talk to anyone, so
// a gateway-less boot must not report healthy. Everything else degrades softly.
const isRequiredName = (name: string): boolean => name.startsWith("gateway-");

// Parse one `name` or `name@version` entry. Grammar violations are fatal — an
// install entry is explicit operator intent, not a degraded-boot situation.
export const parseEntry = (raw: string): InstallEntry => {
  const trimmed = raw.trim();
  const at = trimmed.indexOf("@");
  const name = at === -1 ? trimmed : trimmed.slice(0, at);
  if (!NAME.test(name)) {
    throw new InstallError(`install: invalid skill name "${raw}"`);
  }
  const version = at === -1 ? undefined : trimmed.slice(at + 1);
  if (version !== undefined && !VERSION.test(version)) {
    throw new InstallError(`install: invalid version in "${raw}"`);
  }
  return {
    name,
    ...(version !== undefined && { version }),
    required: isRequiredName(name),
  };
};

// Parse the `install:` block off a resolved config tree. Absent block → no
// install settings (the feature is inert). Duplicate names are fatal.
export const parseInstallSettings = (
  value: unknown,
): InstallSettings | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isJsonRecord(value)) {
    throw new InstallError("install: block must be a mapping");
  }
  const registryValue = value["registry"];
  const registry = typeof registryValue === "string"
    ? registryValue
    : DEFAULT_REGISTRY;
  const refresh = value["refresh"] === true;
  const rawSkills = value["skills"];
  if (rawSkills === undefined) {
    return { registry, refresh, skills: [] };
  }
  if (!Array.isArray(rawSkills)) {
    throw new InstallError("install.skills must be a list");
  }
  const skills = rawSkills.map((item) => {
    if (typeof item !== "string") {
      throw new InstallError("install.skills entries must be strings");
    }
    return parseEntry(item);
  });
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      throw new InstallError(`install: duplicate skill "${skill.name}"`);
    }
    seen.add(skill.name);
  }
  return { registry, refresh, skills };
};
