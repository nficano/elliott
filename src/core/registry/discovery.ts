import { hashValue, newId } from "../digest";
import type { ComponentManifest, ComponentRef } from "../types";
import { ComponentRegistry } from "./registry";
import type {
  ComponentCard,
  ComponentInspectionDetail,
  PrepareComponentCallInput,
  PreparedComponentCall,
  RegistryEntry,
} from "./types";

const risk = (manifest: ComponentManifest): ComponentCard["risk"] => {
  if (manifest.requestedCapabilities.length === 0) return "none";
  return manifest.requestedCapabilities.some((request) =>
      request.capability.startsWith("process.")
      || request.capability.startsWith("secret.")
      || request.capability.startsWith("network.")
    )
    ? "elevated"
    : "low";
};

const toCard = (entry: RegistryEntry): ComponentCard => {
  const common = {
    ref: entry.manifest.ref,
    kind: entry.manifest.schema.kind,
    description: entry.manifest.description,
    operationSummaries: entry.manifest.protocols.map((protocol) => protocol.id),
    risk: risk(entry.manifest),
    availability: entry.availability,
  };
  return Object.freeze({ ...common, digest: hashValue(common) });
};

export class ComponentDiscovery {
  constructor(readonly registry: ComponentRegistry) {}

  search(query: string): readonly ComponentCard[] {
    const normalized = query.trim().toLocaleLowerCase();
    return this.#resolvedEntries().map(toCard).filter((card) =>
      normalized.length === 0
      || card.ref.toLocaleLowerCase().includes(normalized)
      || card.description.toLocaleLowerCase().includes(normalized)
      || card.operationSummaries.some((summary) =>
        summary.toLocaleLowerCase().includes(normalized)
      )
    ).sort((left, right) => left.ref.localeCompare(right.ref));
  }

  inspect(ref: ComponentRef): ComponentInspectionDetail {
    const selected = this.registry.resolve(ref)?.selected;
    if (selected === undefined) throw new Error(`Unknown component ${ref}`);
    return Object.freeze({
      card: toCard(selected),
      protocols: Object.freeze([...selected.manifest.protocols]),
    });
  }

  prepareCall(input: PrepareComponentCallInput): PreparedComponentCall {
    const inspection = this.inspect(input.target);
    if (inspection.card.availability !== "available") {
      throw new Error(`Component ${input.target} is unavailable`);
    }
    const protocol = inspection.protocols.find((candidate) =>
      candidate.id === input.protocol
    );
    if (protocol === undefined) {
      throw new Error(`Component does not support protocol ${input.protocol}`);
    }
    return Object.freeze({
      inspection,
      invocation: Object.freeze({
        id: newId("invocation"),
        principal: input.principal,
        agent: input.agent,
        target: input.target,
        protocol: input.protocol,
        operation: input.operation,
        input: input.input,
        inputSchemaDigest: input.inputSchemaDigest,
        outputSchemaDigest: input.outputSchemaDigest,
        origin: input.origin,
        securityTags: input.securityTags,
        requestedCapabilities: input.requestedCapabilities,
        budget: input.budget,
        snapshot: input.snapshot,
      }),
    });
  }

  #resolvedEntries(): readonly RegistryEntry[] {
    const refs = new Set<ComponentRef>(
      this.registry.list().map((entry) => entry.manifest.ref),
    );
    return [...refs].flatMap((ref) => {
      const selected = this.registry.resolve(ref)?.selected;
      return selected === undefined ? [] : [selected];
    });
  }
}
