import type {
  AuthenticatedRequestInput,
  SecretAuthorizationQuery,
  SecretMountInput,
  SecretRegistration,
  SecretUri,
} from "./types";

export const isSecretUri = (value: string): value is SecretUri =>
  value.startsWith("secret://");

export class OpaqueSecretStore {
  readonly #secrets = new Map<SecretUri, SecretRegistration>();

  register(registration: SecretRegistration): void {
    if (!isSecretUri(registration.uri)) throw new Error("Invalid secret URI");
    this.#secrets.set(registration.uri, Object.freeze(registration));
  }

  containsRegisteredValue(value: unknown): boolean {
    const serialized = typeof value === "string"
      ? value
      : JSON.stringify(value) ?? "";
    return [...this.#secrets.values()].some((registration) =>
      serialized.includes(registration.value)
    );
  }

  assertOutboundSafe(value: unknown): void {
    if (this.containsRegisteredValue(value)) {
      throw new Error("Outbound payload contains a registered secret");
    }
  }

  async authenticatedRequest(
    input: AuthenticatedRequestInput,
  ): Promise<Response> {
    const registration = this.#authorized({
      uri: input.uri,
      principal: input.principal,
      destination: input.destination,
      operation: input.operation,
      injection: "broker-request",
    });
    return input.execute(registration.value);
  }

  async mountInto(
    input: SecretMountInput,
  ): Promise<void> {
    const registration = this.#authorized({
      uri: input.uri,
      principal: input.principal,
      destination: input.container,
      operation: "mount",
      injection: "runtime-mount",
    });
    await input.install(input.container, registration.value);
  }

  #authorized(query: SecretAuthorizationQuery): SecretRegistration {
    const registration = this.#secrets.get(query.uri);
    if (
      registration === undefined
      || registration.policy.principal !== query.principal
      || registration.policy.destination !== query.destination
      || registration.policy.operation !== query.operation
      || registration.policy.injection !== query.injection
      || Date.parse(registration.policy.expiresAt) <= Date.now()
    ) throw new Error("Secret policy denied access");
    return registration;
  }
}

export type * from "./types";
