import { componentRef } from "../core/brands";
import { ManifestValidationError } from "../core/errors";
import type { CapabilityRequest } from "../core/types";
import { expandCapabilityTemplate } from "./templates";
import type {
  LoadAgentSkillInput,
  LoadedAgentSkill,
  ParsedOverlay,
} from "./types";
import { parseSecurityOverlay } from "./yaml";

const FRONTMATTER_START = "---\n";
const FRONTMATTER_END = "\n---\n";

const frontmatter = (markdown: string): readonly [string, string] => {
  if (!markdown.startsWith(FRONTMATTER_START)) return ["", markdown];
  const end = markdown.indexOf(FRONTMATTER_END, FRONTMATTER_START.length);
  if (end === -1) {
    throw new ManifestValidationError("unclosed SKILL.md frontmatter");
  }
  return [
    markdown.slice(FRONTMATTER_START.length, end),
    markdown.slice(end + FRONTMATTER_END.length),
  ];
};

const stringField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string => typeof value[key] === "string" ? value[key] : fallback;

const stringArrayField = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] => {
  const field = value[key];
  if (typeof field === "string") return field.split(/\s+/u).filter(Boolean);
  if (!Array.isArray(field)) return [];
  return field.filter((item): item is string => typeof item === "string");
};

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requestFromUnknown = (value: unknown): CapabilityRequest | undefined => {
  if (!isRecord(value) || typeof value.capability !== "string") {
    return undefined;
  }
  const resources = Array.isArray(value.resources)
    ? value.resources.filter((item): item is string => typeof item === "string")
    : [];
  const common = { capability: value.capability, resources };
  return value.deferred === true ? { ...common, deferred: true } : common;
};

const overlayCapabilities = (
  overlay: ParsedOverlay | undefined,
): readonly CapabilityRequest[] => {
  if (overlay === undefined) return [];
  const capabilityBlock = overlay.value.capabilities;
  const capabilityRecord = isRecord(capabilityBlock) ? capabilityBlock : {};
  const requestValues = Array.isArray(capabilityRecord.request)
    ? capabilityRecord.request
    : [];
  const requests = requestValues.flatMap((value) => {
    const request = requestFromUnknown(value);
    return request === undefined ? [] : [request];
  });
  const removals = stringArrayField(capabilityRecord, "remove");
  const profile = overlay.value.profile;
  return typeof profile === "string"
    ? expandCapabilityTemplate(profile, requests, removals)
      .requestedCapabilities
    : requests.filter((request) => !removals.includes(request.capability));
};

export const loadAgentSkill = (
  input: LoadAgentSkillInput,
): LoadedAgentSkill => {
  if (!input.trustedWorkspace) {
    throw new ManifestValidationError("project skill requires workspace trust");
  }
  const [frontmatterRaw, body] = frontmatter(input.markdown);
  const metadata = frontmatterRaw.length === 0
    ? { raw: "", digest: undefined, value: {} }
    : parseSecurityOverlay(frontmatterRaw);
  const name = stringField(metadata.value, "name", "unnamed-skill");
  const description = stringField(metadata.value, "description", "");
  const overlay: ParsedOverlay | undefined = input.overlayRaw === undefined
    ? undefined
    : parseSecurityOverlay(input.overlayRaw);
  const common = {
    ref: componentRef(`${input.namespace}/skill/${name}`),
    name,
    description,
    markdown: body,
    allowedTools: Object.freeze(
      stringArrayField(metadata.value, "allowed-tools"),
    ),
    requestedCapabilities: Object.freeze(overlayCapabilities(overlay)),
  };
  return overlay === undefined
    ? Object.freeze(common)
    : Object.freeze({ ...common, overlay });
};
