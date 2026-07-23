import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScaffoldRequest, ScaffoldResult } from "./types";

const MAX_COMPONENT_NAME_LENGTH = 64;
const COMPONENT_NAME_CHARACTERS = new Set(
  "abcdefghijklmnopqrstuvwxyz0123456789",
);

const validComponentName = (value: string): boolean =>
  value.length > 0
  && value.length <= MAX_COMPONENT_NAME_LENGTH
  && value.split("-").every((part) =>
    part.length > 0
    && [...part].every((character) => COMPONENT_NAME_CHARACTERS.has(character))
  );

const markdownName = (kind: "skill" | "tool"): string =>
  kind === "skill" ? "SKILL.md" : "TOOL.md";

const overlay = (request: ScaffoldRequest): string =>
  `apiVersion: elliott/v1
kind: ${request.kind}
profile: tool-standard
metadata:
  name: ${request.name}
`;

const document = (request: ScaffoldRequest): string =>
  `---
name: ${request.name}
description: Describe ${request.name}.
---

# ${request.name}
`;

const CONFORMANCE_TEMPLATE = `import { describe, expect, it } from "bun:test";
import {
  Component,
  componentRef,
  defineComponent,
  digest,
  grantHandle,
  placementRef,
  principalId,
  runtimeContractDigest,
  scopeId,
  snapshotId,
} from "elliott/core";
import type {
  ComponentContext,
  ComponentInstance,
  ComponentManifest,
  RuntimeContract,
} from "elliott/core";

const manifest: ComponentManifest = {
  ref: componentRef("workspace/__KIND__/__NAME__"),
  schema: {
    kind: "__KIND__",
    apiVersion: "elliott/v1",
    digest: digest("schema:__KIND__"),
  },
  version: "0.1.0",
  digest: digest("manifest:__NAME__"),
  description: "__NAME__",
  protocols: [],
  requestedCapabilities: [],
  requestedLimits: {},
  provenance: {
    source: "workspace",
    digest: digest("source:__NAME__"),
  },
};

const instance: ComponentInstance = {
  manifest,
  scope: { level: "workspace", id: scopeId("workspace") },
  principal: principalId("principal"),
  configDigest: digest("config"),
  grants: grantHandle("grant"),
  snapshot: snapshotId("snapshot"),
  lifecycle: "created",
  placement: placementRef("placement"),
};

const context: ComponentContext = {
  scope: instance.scope,
  principal: instance.principal,
  snapshot: instance.snapshot,
};

class GeneratedComponent extends Component<
  "__KIND__",
  Readonly<Record<string, never>>
> {
  constructor(
    componentInstance: ComponentInstance,
    componentContext: ComponentContext,
  ) {
    super(componentInstance, {}, componentContext, "__KIND__");
  }
}

const module = defineComponent(
  { manifest, configSchema: {} },
  ({ instance: createdInstance, context: createdContext }) =>
    new GeneratedComponent(createdInstance, createdContext),
);

const staticContract: RuntimeContract = {
  schema: manifest.schema,
  protocols: manifest.protocols,
  requestedCapabilities: manifest.requestedCapabilities,
};

describe("__NAME__ conformance", () => {
  it("constructs with the declared kind (G1)", () => {
    expect(module.create({ instance, config: {}, context }).kind).toBe(
      "__KIND__",
    );
  });

  it("keeps the runtime contract aligned with the manifest (G3)", () => {
    const component = module.create({ instance, config: {}, context });
    const runtimeContract: RuntimeContract = {
      schema: component.manifest.schema,
      protocols: component.manifest.protocols,
      requestedCapabilities: component.manifest.requestedCapabilities,
    };
    expect(runtimeContractDigest(runtimeContract)).toBe(
      runtimeContractDigest(staticContract),
    );
  });
});
`;

const conformance = (request: ScaffoldRequest): string =>
  CONFORMANCE_TEMPLATE.replaceAll("__KIND__", () => request.kind).replaceAll(
    "__NAME__",
    () => request.name,
  );

export const scaffoldComponent = async (
  request: ScaffoldRequest,
): Promise<ScaffoldResult> => {
  if (!validComponentName(request.name)) {
    throw new Error("Component name must be lowercase kebab-case");
  }
  const directory = path.resolve(request.parentDirectory, request.name);
  const tests = path.join(directory, "tests");
  await mkdir(tests, { recursive: true });
  const markdownPath = path.join(directory, markdownName(request.kind));
  const overlayPath = path.join(directory, "component.yaml");
  const testPath = path.join(tests, "conformance.test.ts");
  const files = [markdownPath, overlayPath, testPath];
  await Promise.all([
    writeFile(markdownPath, document(request), { flag: "wx" }),
    writeFile(overlayPath, overlay(request), { flag: "wx" }),
    writeFile(testPath, conformance(request), { flag: "wx" }),
  ]);
  return { kind: request.kind, directory, files };
};
