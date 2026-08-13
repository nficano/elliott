import type {
  ErrorSink,
  InboundMessage,
  RuntimeSettings,
  ToolDefinition,
  TurnObserver,
} from "../types";

export type JsonRecord = Readonly<Record<string, unknown>>;

// Resolves a hostname to every address it answers to, so publicUrl() can
// reject a DNS name whose resolved address is private even when the name
// itself doesn't look like one (nip.io, sslip.io, DNS rebinding). Injectable
// so tests validate the classification logic without a live DNS lookup —
// production callers get the real resolver by default.
export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

// The outcome of validating a caller-supplied destination against the
// public-egress guard: the parsed URL, its bare (bracket-stripped) hostname,
// and the exact resolved address that was checked. fetchPublicUrl() pins its
// connection to `address` rather than letting the eventual fetch() resolve
// the hostname again, which would reopen the DNS-rebinding gap the check
// exists to close.
export interface ValidatedDestination {
  readonly url: URL;
  readonly hostname: string;
  readonly address: string;
}

export interface GatewayFeedback {
  readonly gateway: string;
  readonly channel: string;
  readonly message: string;
  readonly sender: string;
  readonly sentiment: "positive" | "negative";
  readonly source: "button" | "reaction";
}

export interface GatewayEvents {
  readonly onMessage: (message: InboundMessage) => Promise<void>;
  readonly onFeedback: (feedback: GatewayFeedback) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

export interface GatewayResponse {
  readonly observer?: TurnObserver;
  complete(text: string): Promise<void>;
  fail(message: string): Promise<void>;
}

export interface GatewayBinding {
  readonly name: string;
  readonly defaultChannel?: string;
  status(): string;
  start(events: GatewayEvents): Promise<void>;
  send?(channel: string, text: string, thread?: string): Promise<void>;
  beginResponse?(message: InboundMessage): Promise<GatewayResponse>;
  stop(): void | Promise<void>;
}

export interface RouteBinding {
  readonly method: string;
  readonly path: string;
  handle(request: Request, events: GatewayEvents): Promise<Response>;
}

export interface ServiceBinding {
  readonly name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  health?(): Readonly<Record<string, number>>;
}

// --- Facilities -------------------------------------------------------------
// The fifth binding kind on the register() seam: a skill *provides* a facility
// (infrastructure other skills can consume); a consumer *acquires* a grant
// from it during its own register(). list/describe/acquire deliberately
// mirror MCP's tools/list + tools/call so the same records can later back
// ComponentDiscovery cards. See docs/explanation/skill-facilities.md.

export interface FacilityDescriptor {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly requestSchema: JsonRecord;
  readonly grantSchema: JsonRecord;
}

export interface FacilityRequest {
  // Stamped by the loader from the acquiring package's metadata.name — never
  // caller-supplied, so a skill cannot impersonate another consumer.
  readonly consumer: string;
  readonly name: string;
  readonly config: JsonRecord;
}

export interface FacilityGrant {
  readonly grantId: string;
  readonly facility: string;
  readonly values: JsonRecord;
}

export interface FacilityBinding {
  readonly id: string;
  readonly version: number;
  describe(): FacilityDescriptor;
  acquire(request: FacilityRequest): Promise<FacilityGrant>;
  release?(grantId: string): Promise<void>;
}

export interface FacilityDirectory {
  list(): readonly FacilityDescriptor[];
  describe(id: string): FacilityDescriptor | undefined;
  acquire(id: string, name: string, config: JsonRecord): Promise<FacilityGrant>;
  // Tears down the provisioned resource behind one of this consumer's grants.
  // Destructive; never called implicitly by the runtime.
  release(grantId: string): Promise<void>;
}

export interface StoredGrant {
  readonly consumer: string;
  readonly name: string;
  readonly facilityId: string;
  readonly version: number;
  readonly config: JsonRecord;
  readonly grant: FacilityGrant;
}

export interface RegisteredFacility {
  readonly provider: string;
  readonly binding: FacilityBinding;
}

// A read-only view of one bundled package after the loader has run: its
// manifest topology block plus what its register() actually produced. This is
// what lets the telemetry map auto-register every skill — and it is the same
// record shape that can later back ComponentDiscovery cards.
export interface SkillPackageView {
  readonly name: string;
  readonly kind: string;
  readonly directory: string;
  // Facility ids from manifest spec.provides (e.g. "core/proxy.route").
  readonly provides: readonly string[];
  // The manifest's spec.topology block, verbatim.
  readonly topology?: JsonRecord;
  // register() completed without throwing.
  readonly registered: boolean;
  // How many bindings of each kind the registration returned.
  readonly bindings: Readonly<Record<BindingKind, number>>;
}

export type BindingKind =
  | "tools"
  | "gateways"
  | "routes"
  | "services"
  | "facilities";

export interface SkillContext {
  readonly settings: RuntimeSettings;
  readonly stateDirectory: string;
  readonly facilities: FacilityDirectory;
  // Every bundled package with its post-load state. Populated once boot
  // completes: during register() it is empty; route handlers and services
  // (which only run after boot) see the full list.
  packages(): readonly SkillPackageView[];
  report(error: unknown, mechanism: string): void;
  // Install a sink that receives every subsequently-captured error, already
  // normalized and secret-free. The runtime forwards its error reporter's
  // captures here; the glitchtip skill uses it to attach error reporting
  // without the core runtime depending on any reporter transport. A skill that
  // installs no sink (or is disabled) leaves error handling at the console
  // baseline — nothing about it appears at boot.
  installErrorSink(sink: ErrorSink): void;
  deliver(text: string): Promise<void>;
}

// What the runtime hands the loader: everything on SkillContext except the
// facility directory, which the loader builds and scopes per package.
export type SkillContextSeed = Omit<SkillContext, "facilities">;

export interface SkillRegistration {
  readonly tools?: readonly ToolDefinition[];
  readonly gateways?: readonly GatewayBinding[];
  readonly routes?: readonly RouteBinding[];
  readonly services?: readonly ServiceBinding[];
  readonly facilities?: readonly FacilityBinding[];
}

export type SkillRegistrar = (
  context: SkillContext,
) => Promise<SkillRegistration> | SkillRegistration;

export interface LoadedSkill {
  readonly name: string;
  readonly registration: SkillRegistration;
}
