import { AuditLog, MemoryCommitAdapter } from "./audit/index";
import { PostureController } from "./config/postures/index";
import { scopeId } from "./core/brands";
import { DiscoveryPipeline } from "./core/discovery/discovery";
import type {
  RuntimeContract,
  RuntimeContractLoader,
  StaticPackageDescriptor,
} from "./core/discovery/types";
import { ValidationCache } from "./core/discovery/validation-cache";
import { EpochRegistry } from "./core/epoch/epochs";
import { ComponentRegistry } from "./core/registry/registry";
import { ComponentSchemaRegistry } from "./core/schema/schema";
import { SnapshotStore } from "./core/snapshot/snapshot";
import type { AgentKernelOptions } from "./kernel/types";
import { ProviderStateRegistry } from "./model/provider";
import { ModelDispatcher } from "./model/resolver";
import { RouteTableStore } from "./model/routetable";
import { FootprintTracker } from "./observability/index";
import { PlacementManager } from "./placement/pools/index";
import { CapabilityBroker } from "./security/broker/broker";
import { GrantManager } from "./security/grants/manager";
import { ResidencyRegistry } from "./security/residency/residency";
import { OpaqueSecretStore } from "./security/secrets/secrets";

const DEFAULT_VALIDATION_LOGIC_VERSION = "phase-one-v1";

class MissingRuntimeLoader implements RuntimeContractLoader {
  async load(descriptor: StaticPackageDescriptor): Promise<RuntimeContract> {
    void descriptor;
    throw new Error("No runtime contract loader configured");
  }
}

export class AgentKernel {
  readonly registry = new ComponentRegistry();
  readonly schemas = new ComponentSchemaRegistry();
  readonly snapshots = new SnapshotStore();
  readonly validationCache = new ValidationCache();
  readonly auditAdapter = new MemoryCommitAdapter();
  readonly records = new AuditLog(this.auditAdapter);
  readonly epochs = new EpochRegistry(this.records);
  readonly routeTables = new RouteTableStore();
  readonly grants = new GrantManager(this.epochs);
  readonly secrets = new OpaqueSecretStore();
  readonly broker = new CapabilityBroker(
    this.grants,
    this.records,
    this.secrets,
  );
  readonly placement = new PlacementManager(this.records);
  readonly footprints = new FootprintTracker();
  readonly postures: PostureController;
  readonly residency: ResidencyRegistry;
  readonly providers: ProviderStateRegistry;
  readonly dispatcher = new ModelDispatcher(this.routeTables, this.records);
  readonly discovery: DiscoveryPipeline;
  #started = false;

  constructor(options: AgentKernelOptions = {}) {
    this.postures = new PostureController(options.posture ?? "standard");
    this.residency = new ResidencyRegistry(this.records, async (provider) => {
      this.routeTables.invalidateProvider(provider);
      await this.epochs.bump(
        "organization",
        "model-providers",
        "residency-change",
      );
    });
    this.providers = new ProviderStateRegistry(
      this.records,
      async (provider) => {
        this.routeTables.invalidateProvider(provider);
        await this.epochs.bump(
          "organization",
          "model-providers",
          "catalog-update",
        );
      },
      async (provider) => {
        this.routeTables.invalidateProvider(provider);
        this.dispatcher.clearStickiness();
      },
    );
    this.discovery = new DiscoveryPipeline(
      this.schemas,
      this.validationCache,
      options.runtimeLoader ?? new MissingRuntimeLoader(),
      this.records,
      options.validationLogicVersion ?? DEFAULT_VALIDATION_LOGIC_VERSION,
    );
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error("AgentKernel already started");
    await this.records.append({
      type: "kernel.started",
      scope: { level: "builtin", id: scopeId("kernel") },
      durability: "effect-gating",
      classification: "internal",
      payload: { posture: this.postures.current.posture },
    });
    this.#started = true;
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    await this.records.append({
      type: "kernel.stopped",
      scope: { level: "builtin", id: scopeId("kernel") },
      durability: "observational",
      classification: "internal",
      payload: {},
    });
    await this.records.crossLink();
    this.#started = false;
  }
}

export type * from "./kernel/types";
