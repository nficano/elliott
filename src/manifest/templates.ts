import { hashValue } from "../core/digest";
import { ManifestValidationError } from "../core/errors";
import type { CapabilityRequest } from "../core/types";
import type { CapabilityTemplate, ExpandedCapabilities } from "./types";

const templates: readonly CapabilityTemplate[] = Object.freeze([
  {
    name: "tool-standard",
    version: "1",
    capabilities: [
      { capability: "fs.read", resources: ["package://self/**"] },
      { capability: "fs.write", resources: ["scratch://self/**"] },
      { capability: "network.fetch", resources: ["declared://hosts/**"] },
    ],
  },
  {
    name: "tool-local-only",
    version: "1",
    capabilities: [
      { capability: "fs.read", resources: ["package://self/**"] },
      { capability: "fs.write", resources: ["scratch://self/**"] },
    ],
  },
  {
    name: "resource-reader",
    version: "1",
    capabilities: [
      { capability: "resource.read", resources: ["declared://resources/**"] },
    ],
  },
  {
    name: "prompt-source-zero-authority",
    version: "1",
    capabilities: [],
  },
]);

export const capabilityTemplates = (): readonly CapabilityTemplate[] =>
  templates;

export const expandCapabilityTemplate = (
  name: string,
  additions: readonly CapabilityRequest[] = [],
  removals: readonly string[] = [],
): ExpandedCapabilities => {
  const template = templates.find((candidate) => candidate.name === name);
  if (template === undefined) {
    throw new ManifestValidationError(`unknown capability template ${name}`);
  }
  const requestedCapabilities = [...template.capabilities, ...additions].filter(
    (request) => !removals.includes(request.capability),
  );
  return Object.freeze({
    template,
    requestedCapabilities: Object.freeze(requestedCapabilities),
    manifestDigest: hashValue({
      template: template.name,
      templateVersion: template.version,
      requestedCapabilities,
    }),
  });
};
