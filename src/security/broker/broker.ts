import { scopeId } from "../../core/brands";
import { hashValue, newId } from "../../core/digest";
import type { DataClassification } from "../../core/types";
import type { Grant, RecordAppender } from "../../core/waist/types";
import type { GrantManager } from "../grants/manager";
import type { GrantSet } from "../grants/types";
import type { OpaqueSecretStore } from "../secrets/secrets";
import { StreamedArgumentInspector } from "./stream-inspector";
import type {
  BrokeredProviderToolCall,
  BrokerExecutionInput,
  StreamBrokerExecutionInput,
} from "./types";

const CLASSIFICATIONS: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];
const WILDCARD_SUFFIX_LENGTH = 2;

const resourceAllowed = (allowed: string, requested: string): boolean => {
  if (allowed === requested) return true;
  return allowed.endsWith("/**")
    && requested.startsWith(allowed.slice(0, -WILDCARD_SUFFIX_LENGTH));
};

export class CapabilityBroker {
  readonly #grants: GrantManager;
  readonly #records: RecordAppender;
  readonly #secrets: OpaqueSecretStore;

  constructor(
    grants: GrantManager,
    records: RecordAppender,
    secrets: OpaqueSecretStore,
  ) {
    this.#grants = grants;
    this.#records = records;
    this.#secrets = secrets;
  }

  async execute<Result>(input: BrokerExecutionInput<Result>): Promise<Result> {
    this.#assertClassification(input);
    this.#secrets.assertOutboundSafe(input.arguments);
    const grantSet = await this.#grants.resolve(input.handle);
    const grant = this.#materialize(input, grantSet);
    await this.#records.append({
      type: "broker.dispatch",
      scope: { level: "invocation", id: scopeId(input.invocation.origin.id) },
      durability: "effect-gating",
      classification: input.frameClassification,
      payload: {
        invocation: input.invocation.id,
        target: input.invocation.target,
        capability: input.capability,
        resource: input.resource,
        inputDigest: hashValue(input.arguments),
      },
    });
    const result = await input.execute(grant, input.arguments);
    await this.#records.append({
      type: "broker.result",
      scope: { level: "invocation", id: scopeId(input.invocation.origin.id) },
      durability: "observational",
      classification: input.frameClassification,
      payload: {
        invocation: input.invocation.id,
        resultDigest: hashValue(result),
      },
    });
    return result;
  }

  async executeProviderToolCall<Result>(
    input: BrokeredProviderToolCall<Result>,
  ): Promise<Result> {
    await this.#records.append({
      type: "provider.tool-call-returned",
      scope: { level: "invocation", id: scopeId(input.invocation.origin.id) },
      durability: "observational",
      classification: input.frameClassification,
      payload: { provider: input.provider, invocation: input.invocation.id },
    });
    return this.execute(input);
  }

  beginStream<Result>(
    input: StreamBrokerExecutionInput<Result>,
  ): StreamedArgumentInspector<Result> {
    this.#assertClassification(input);
    return new StreamedArgumentInspector(input.scanner, async () => {
      const initial = await this.#grants.resolve(input.handle);
      const grant = this.#materialize(input, initial);
      const prepared = await input.prepare(grant);
      return {
        planDigest: prepared.planDigest,
        discard: prepared.discard,
        commit: async (completeArguments) => {
          this.#secrets.assertOutboundSafe(completeArguments);
          await this.#grants.resolve(input.handle);
          await this.#records.append({
            type: "broker.dispatch",
            scope: {
              level: "invocation",
              id: scopeId(input.invocation.origin.id),
            },
            durability: "effect-gating",
            classification: input.frameClassification,
            payload: {
              invocation: input.invocation.id,
              capability: input.capability,
              resource: input.resource,
              planDigest: prepared.planDigest,
              inputDigest: hashValue(completeArguments),
            },
          });
          return prepared.commit(completeArguments);
        },
      };
    });
  }

  #materialize(
    input: StreamBrokerExecutionInput<unknown> | BrokerExecutionInput<unknown>,
    grantSet: GrantSet,
  ): Grant {
    const capability = grantSet.capabilities.find((candidate) =>
      candidate.capability === input.capability
      && candidate.resources.some((resource) =>
        resourceAllowed(resource, input.resource)
      )
    );
    if (capability === undefined) {
      throw new Error(
        `Capability denied: ${input.capability} ${input.resource}`,
      );
    }
    return Object.freeze({
      id: newId("grant"),
      invocationId: input.invocation.id,
      principal: input.invocation.principal,
      capability: input.capability,
      resource: input.resource,
      constraints: Object.freeze({}),
      policyDecision: hashValue(grantSet),
    });
  }

  #assertClassification(input: {
    readonly frameClassification: DataClassification;
    readonly destinationMaximumClassification: DataClassification;
  }): void {
    if (
      CLASSIFICATIONS.indexOf(input.frameClassification)
        > CLASSIFICATIONS.indexOf(input.destinationMaximumClassification)
    ) throw new Error("Outbound classification exceeds destination policy");
  }
}

export type * from "./types";
