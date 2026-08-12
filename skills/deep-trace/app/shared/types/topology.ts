// Shapes of docs/elliott-topology.enriched.json as served by
// GET /v1/observability/map/topology. Only the fields the explorer reads are
// modeled; unknown extras flow through untouched.

export interface RawClassifications {
  readonly trustZone?: string;
  readonly criticality?: string;
  readonly dataClassification?: string;
  readonly scalability?: string;
  readonly failureMode?: string;
}

export interface RawNode {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
  readonly domain?: string;
  readonly runtime?: string;
  readonly source?: string;
  readonly interface?: string;
  readonly characteristics?: readonly string[];
  readonly classifications?: RawClassifications;
  readonly tables?: readonly string[];
  readonly tablesWrittenAtRuntime?: readonly string[];
  readonly models?: readonly string[];
}

export interface RawEdgeContract {
  readonly direction?: string;
  readonly payload?: string;
  readonly delivery?: string;
  readonly ordering?: string;
  readonly idempotency?: string;
  readonly errorHandling?: string;
  readonly authz?: string;
}

export interface RawEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind?: string;
  readonly label?: string;
  readonly protocol?: string;
  readonly routing?: string;
  readonly carries?: string;
  readonly security?: string;
  readonly evidence?: string;
  readonly activation?: string;
  readonly contract?: RawEdgeContract;
}

export interface RawDomain {
  readonly id: string;
  readonly title?: string;
  readonly purpose?: string;
  readonly trustBoundary?: string;
  readonly failureIsolation?: string;
}

export interface RawTopology {
  readonly version?: string;
  readonly title?: string;
  readonly note?: string;
  readonly runtimeLegend?: Readonly<Record<string, string>>;
  readonly classificationSchemes?: Readonly<Record<string, unknown>>;
  readonly enrichmentNotes?: unknown;
  readonly domains?: readonly RawDomain[];
  readonly nodes?: readonly RawNode[];
  readonly edges?: readonly RawEdge[];
}
