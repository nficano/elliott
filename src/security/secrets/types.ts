import type { PrincipalId } from "../../core/types";

export type SecretUri = `secret://${string}`;
export type SecretInjection = "broker-request" | "runtime-mount";

export interface SecretPolicy {
  readonly principal: PrincipalId;
  readonly destination: string;
  readonly operation: string;
  readonly expiresAt: string;
  readonly rotation: string;
  readonly injection: SecretInjection;
}

export interface SecretRegistration {
  readonly uri: SecretUri;
  readonly value: string;
  readonly policy: SecretPolicy;
}

export interface AuthenticatedRequestInput {
  readonly uri: SecretUri;
  readonly principal: PrincipalId;
  readonly destination: string;
  readonly operation: string;
  readonly execute: (secretValue: string) => Promise<Response>;
}

export interface SecretMountInput {
  readonly uri: SecretUri;
  readonly principal: PrincipalId;
  readonly container: string;
  readonly install: (
    container: string,
    secretValue: string,
  ) => Promise<void>;
}

export interface SecretAuthorizationQuery {
  readonly uri: SecretUri;
  readonly principal: PrincipalId;
  readonly destination: string;
  readonly operation: string;
  readonly injection: SecretInjection;
}
