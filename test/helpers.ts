import {
  componentRef,
  digest,
  epoch,
  grantHandle,
  placementRef,
  principalId,
  protocolId,
  scopeId,
  snapshotId,
} from "../src/core/brands";
import type {
  CapabilityRequest,
  ComponentInstance,
  ComponentKind,
  ComponentManifest,
  ComponentSchema,
  EpochVector,
  GrantHandle,
  ProtocolDescriptor,
} from "../src/core/types";
import type { Invocation } from "../src/core/waist/types";
import type { ProviderState } from "../src/model/provider/types";
import type { RouteBuildContext } from "../src/model/routing/types";
import type {
  ModelCatalogEntry,
  ModelProviderProtocol,
} from "../src/model/types";
import type {
  CapabilityGrantSource,
  GrantIssueInput,
} from "../src/security/grants/types";
import type { ResidencyGrant } from "../src/security/residency/types";

const GRANT_SOURCE_NAMES: readonly CapabilityGrantSource[] = [
  "request",
  "package",
  "organization",
  "workspace",
  "agent",
  "principal",
  "session",
];

export const makeManifest = (
  kind: ComponentKind = "tool",
  ref = "workspace/tool/example",
  requestedCapabilities: readonly CapabilityRequest[] = [],
  protocols: readonly ProtocolDescriptor[] = [],
): ComponentManifest => ({
  ref: componentRef(ref),
  schema: {
    kind,
    apiVersion: "elliott/v1",
    digest: digest(`schema:${kind}`),
  },
  version: "1.0.0",
  digest: digest(`manifest:${ref}`),
  description: `Test ${kind}`,
  protocols,
  requestedCapabilities,
  requestedLimits: {},
  provenance: { source: "test", digest: digest(`source:${ref}`) },
});

export const makeSchema = (
  kind: ComponentKind = "tool",
  minimumIsolation: ComponentSchema["minimumIsolation"] = "process",
): ComponentSchema => ({
  kind,
  apiVersion: "elliott/v1",
  digest: digest(`schema:${kind}`),
  documentName: `${kind.toUpperCase()}.md`,
  manifestSchema: {},
  minimumIsolation,
});

export const makeInstance = (
  manifest: ComponentManifest = makeManifest(),
): ComponentInstance => ({
  manifest,
  scope: { level: "workspace", id: scopeId("workspace") },
  principal: principalId("principal"),
  configDigest: digest("config"),
  grants: grantHandle("grant"),
  snapshot: snapshotId("snapshot"),
  lifecycle: "created",
  placement: placementRef("placement"),
});

export const zeroEpochVector = (): EpochVector => ({
  org: epoch(0),
  workspace: epoch(0),
  agent: epoch(0),
  session: epoch(0),
  principal: epoch(0),
});

export const makeCatalogEntry = (
  modelId = "model",
  locality: ModelCatalogEntry["declaredLocality"] = "local",
  capabilities: ModelCatalogEntry["capabilities"] = ["text"],
): ModelCatalogEntry => ({
  modelId,
  capabilities,
  maxInputTokens: 8192,
  maxOutputTokens: 2048,
  costPerThousandInputTokensUsd: 0.1,
  costPerThousandOutputTokensUsd: 0.2,
  declaredLocality: locality,
  available: true,
  catalogDigest: digest(`catalog:${modelId}`),
});

export const makeResidencyGrant = (
  provider = "local",
  egress: ResidencyGrant["egress"] = "none",
  maximumClassification: ResidencyGrant["maximumClassification"] = "restricted",
): ResidencyGrant => ({
  ref: componentRef(`organization/residency/${provider}`),
  provider,
  egress,
  allowedDestinations: [],
  maximumClassification,
  topologyDigest: digest(`topology:${provider}`),
  verifiedAt: new Date().toISOString(),
  revoked: false,
});

const protocol: ModelProviderProtocol = {
  async catalog() {
    return [];
  },
  async *generate() {
    yield { type: "done", payload: {} };
  },
  async embed() {
    return { embeddings: [] };
  },
  async health() {
    return { healthy: true };
  },
};

export const makeProviderState = (
  id = "local",
  catalog: readonly ModelCatalogEntry[] = [makeCatalogEntry()],
  residency = makeResidencyGrant(id),
  healthy = true,
): ProviderState => ({
  id,
  protocol,
  residency,
  catalog,
  catalogDigest: digest(`provider-catalog:${id}`),
  health: { healthy, reportedAtMs: 0, cadenceMs: 1000 },
});

export const makeRouteContext = (
  provider = makeProviderState(),
  posture: RouteBuildContext["posture"] = "regulated",
): RouteBuildContext => {
  const route = {
    provider: provider.id,
    model: provider.catalog[0]?.modelId ?? "model",
    priority: 1,
    costMetric: 0,
  };
  return {
    profiles: {
      profiles: {
        fast: { routes: [route], digest: digest("profile:fast") },
        balanced: { routes: [route], digest: digest("profile:balanced") },
        deep: { routes: [route], digest: digest("profile:deep") },
      },
    },
    maximumProfile: "deep",
    providers: [provider],
    posture,
    epochVector: zeroEpochVector(),
    inputDigests: [provider.catalogDigest, provider.residency.topologyDigest],
  };
};

export const testProtocol = (
  id = "tool.executor",
): ProtocolDescriptor => ({ id: protocolId(id), schema: { type: "object" } });

export const makeInvocation = (): Invocation => ({
  id: "invocation:test",
  principal: principalId("principal"),
  agent: componentRef("workspace/agent/test"),
  target: componentRef("workspace/tool/test"),
  protocol: protocolId("tool.executor"),
  operation: "execute",
  input: {},
  inputSchemaDigest: digest("input"),
  outputSchemaDigest: digest("output"),
  origin: {
    id: "origin:test",
    actorTrust: "authenticated",
    contentTrust: "trusted",
    classification: "internal",
    securityTags: [],
    payload: {},
    createdAt: new Date().toISOString(),
  },
  securityTags: [],
  requestedCapabilities: [],
  budget: {},
  snapshot: snapshotId("snapshot"),
});

export const makeGrantIssue = (
  handle: GrantHandle = grantHandle("grant:test"),
  onDrain: () => void = () => undefined,
  capability = "network.connect",
): GrantIssueInput => ({
  handle,
  coordinates: {
    organization: "organization",
    workspace: "workspace",
    agent: "agent",
    session: "session",
    principal: "principal",
  },
  policyDigests: [digest("policy")],
  onDrain,
  sources: GRANT_SOURCE_NAMES.map((name) => ({
    name,
    capabilities: [{ capability, resources: ["https://example.com/**"] }],
  })),
  limitSources: [
    { name: "organization", limits: { maxTokens: 100, maxCostUsd: 5 } },
    { name: "invocation", limits: { maxTokens: 50, maxCostUsd: 2 } },
  ],
});
