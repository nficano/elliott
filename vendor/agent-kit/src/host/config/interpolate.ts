import type { SecretResolver } from "./types.js";

/**
 * `${…}` interpolation (§5). Secrets are never inlined in YAML; they are
 * resolved at LOAD by a short-lived resolver. The last-known-good snapshot keeps
 * the PRE-interpolation source (placeholders intact) so resolved secrets never
 * touch disk (§5 secret lifecycle).
 *
 * Grammar:
 *   ${VAULT:secret/path#field}   → SecretResolver.vault(path, field)
 *   ${ENV:NAME}  |  ${NAME}      → SecretResolver.env(NAME)
 */

const PLACEHOLDER = /\$\{([^}]+)\}/g;

export class InterpolationError extends Error {}

/** Resolve every `${…}` in every string leaf of `tree`. */
export async function interpolate(
  tree: unknown,
  resolver: SecretResolver,
): Promise<unknown> {
  if (typeof tree === "string") return resolveString(tree, resolver);
  if (Array.isArray(tree)) {
    return Promise.all(tree.map((v) => interpolate(v, resolver)));
  }
  if (tree && typeof tree === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
      out[k] = await interpolate(v, resolver);
    }
    return out;
  }
  return tree;
}

async function resolveString(
  s: string,
  resolver: SecretResolver,
): Promise<string> {
  const matches = [...s.matchAll(PLACEHOLDER)];
  if (matches.length === 0) return s;
  let out = s;
  for (const m of matches) {
    const raw = m[1]!.trim();
    const value = await resolveOne(raw, resolver);
    out = out.replace(m[0], () => value);
  }
  return out;
}

async function resolveOne(
  expr: string,
  resolver: SecretResolver,
): Promise<string> {
  if (expr.startsWith("VAULT:")) {
    const spec = expr.slice("VAULT:".length);
    const hash = spec.lastIndexOf("#");
    if (hash === -1) {
      throw new InterpolationError(`VAULT ref missing #field: ${expr}`);
    }
    const path = spec.slice(0, hash);
    const field = spec.slice(hash + 1);
    return resolver.vault(path, field);
  }
  const name = expr.startsWith("ENV:") ? expr.slice("ENV:".length) : expr;
  const v = resolver.env(name);
  if (v === undefined) throw new InterpolationError(`env var not set: ${name}`);
  return v;
}

/** Env-only resolver (dev / tests). Vault refs throw. */
export function envResolver(
  env: NodeJS.ProcessEnv = process.env,
): SecretResolver {
  return {
    env: (name) => env[name],
    vault: async (path) => {
      throw new InterpolationError(`no Vault resolver configured for ${path}`);
    },
  };
}
