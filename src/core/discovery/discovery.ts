import { scopeId } from "../brands";
import { hashValue } from "../digest";
import { RuntimeContractMismatchError } from "../errors";
import { ComponentSchemaRegistry } from "../schema/schema";
import type { ComponentRef, Digest } from "../types";
import type { RecordAppender } from "../waist/types";
import type {
  DiscoveredComponent,
  RuntimeContract,
  RuntimeContractLoader,
  ScanCounters,
  StaticPackageDescriptor,
  ValidationVerdict,
} from "./types";
import { ValidationCache } from "./validation-cache";

export const runtimeContractDigest = (contract: RuntimeContract): Digest =>
  hashValue({
    schema: contract.schema,
    protocols: [...contract.protocols].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    requestedCapabilities: [...contract.requestedCapabilities].sort(
      (left, right) => left.capability.localeCompare(right.capability),
    ),
  });

export class DiscoveryPipeline {
  readonly #components = new Map<ComponentRef, DiscoveredComponent>();
  readonly #schemas: ComponentSchemaRegistry;
  readonly #cache: ValidationCache;
  readonly #loader: RuntimeContractLoader;
  readonly #records: RecordAppender;
  readonly #validationLogicVersion: string;
  #counters: ScanCounters = {
    parsed: 0,
    provenanceVerified: 0,
    cacheHits: 0,
  };

  constructor(
    schemas: ComponentSchemaRegistry,
    cache: ValidationCache,
    loader: RuntimeContractLoader,
    records: RecordAppender,
    validationLogicVersion: string,
  ) {
    this.#schemas = schemas;
    this.#cache = cache;
    this.#loader = loader;
    this.#records = records;
    this.#validationLogicVersion = validationLogicVersion;
  }

  async scan(
    descriptors: readonly StaticPackageDescriptor[],
    validateStatic: (descriptor: StaticPackageDescriptor) => Promise<void>,
    verifyProvenance: (descriptor: StaticPackageDescriptor) => Promise<void>,
  ): Promise<readonly DiscoveredComponent[]> {
    for (const descriptor of descriptors) {
      await this.#scanOne(descriptor, validateStatic, verifyProvenance);
    }
    return this.list();
  }

  async instantiate(ref: ComponentRef): Promise<RuntimeContract> {
    const discovered = this.#components.get(ref);
    if (discovered === undefined || discovered.availability === "unavailable") {
      throw new Error(`Component ${ref} is unavailable`);
    }
    const runtime = await this.#loader.load(discovered.descriptor);
    const runtimeDigest = runtimeContractDigest(runtime);
    if (runtimeDigest !== discovered.descriptor.runtimeContractHash) {
      const error = new RuntimeContractMismatchError(
        discovered.descriptor.runtimeContractHash,
        runtimeDigest,
      );
      await this.#quarantine(discovered.descriptor, error.message);
      throw error;
    }
    return Object.freeze(runtime);
  }

  resolve(ref: ComponentRef): DiscoveredComponent | undefined {
    return this.#components.get(ref);
  }

  list(): readonly DiscoveredComponent[] {
    return [...this.#components.values()];
  }

  counters(): ScanCounters {
    return { ...this.#counters };
  }

  async #scanOne(
    descriptor: StaticPackageDescriptor,
    validateStatic: (descriptor: StaticPackageDescriptor) => Promise<void>,
    verifyProvenance: (descriptor: StaticPackageDescriptor) => Promise<void>,
  ): Promise<void> {
    const cached = this.#cache.get({
      packageDigest: descriptor.packageDigest,
      schemaDigests: descriptor.schemaDigests,
      provenanceTrustRoot: descriptor.provenanceTrustRoot,
      validationLogicVersion: this.#validationLogicVersion,
    });
    if (cached !== undefined) {
      this.#counters = {
        ...this.#counters,
        cacheHits: this.#counters.cacheHits + 1,
      };
      this.#registerDescriptor(descriptor, cached.verdict);
      return;
    }
    try {
      await validateStatic(descriptor);
      this.#counters = { ...this.#counters, parsed: this.#counters.parsed + 1 };
      this.#schemas.validateManifest(
        descriptor.manifest,
        descriptor.requestedIsolation,
      );
      await verifyProvenance(descriptor);
      this.#counters = {
        ...this.#counters,
        provenanceVerified: this.#counters.provenanceVerified + 1,
      };
      this.#cacheVerdict(descriptor, "valid");
      this.#registerDescriptor(descriptor, "valid");
    } catch (error) {
      await this.#quarantine(
        descriptor,
        error instanceof Error ? error.message : "validation failed",
      );
    }
  }

  #cacheVerdict(
    descriptor: StaticPackageDescriptor,
    verdict: ValidationVerdict,
  ): void {
    this.#cache.put({
      packageDigest: descriptor.packageDigest,
      schemaDigests: descriptor.schemaDigests,
      provenanceTrustRoot: descriptor.provenanceTrustRoot,
      validationLogicVersion: this.#validationLogicVersion,
      runtimeContractHash: descriptor.runtimeContractHash,
      verdict,
    });
  }

  #registerDescriptor(
    descriptor: StaticPackageDescriptor,
    verdict: ValidationVerdict,
  ): void {
    this.#components.set(
      descriptor.manifest.ref,
      Object.freeze({
        ref: descriptor.manifest.ref,
        descriptor,
        availability: verdict === "valid" ? "available" : "unavailable",
      }),
    );
  }

  async #quarantine(
    descriptor: StaticPackageDescriptor,
    reason: string,
  ): Promise<void> {
    await this.#records.append({
      type: "component.quarantined",
      scope: { level: "organization", id: scopeId(descriptor.manifest.ref) },
      durability: "effect-gating",
      classification: "internal",
      payload: { ref: descriptor.manifest.ref, reason },
    });
    this.#cacheVerdict(descriptor, "quarantined");
    this.#components.set(
      descriptor.manifest.ref,
      Object.freeze({
        ref: descriptor.manifest.ref,
        descriptor,
        availability: "unavailable",
        reason,
      }),
    );
  }
}
