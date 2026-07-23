import type { SecretResolver } from "agent-kit";

const environment = Bun.env;

export const runtimeEnvironment = environment;

export const runtimeName = environment["ELLIOTT_ENV"] ?? "prod";

export const envBackedSecretResolver: SecretResolver = {
  env: (name) => environment[name],
  vault: async (_path, field) => {
    const value = environment[field];
    if (value === undefined) {
      throw new Error(`vault-rendered environment is missing ${field}`);
    }
    return value;
  },
};
