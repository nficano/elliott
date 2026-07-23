import type {
  Manifest,
  Registrable,
  RegistryDeps,
  RegistryIndexState,
  ShadowedEntry,
} from "./types.js";

export function resolveSecrets(
  manifest: Manifest,
  block: Record<string, unknown>,
): { ok: true; secrets: Record<string, string>; } | {
  ok: false;
  why: string;
} {
  const supplied = (block.secrets ?? {}) as Record<string, string>;
  const declarations = manifest.secrets ?? [];
  const declared = new Set(declarations.map((item) => item.name));
  const unknown = Object.keys(supplied).find((name) => !declared.has(name));
  if (unknown) {
    return {
      ok: false,
      why: `secret '${unknown}' supplied but not declared in the manifest`,
    };
  }
  return collectSecrets(declarations, supplied);
}

export function checkProvides(
  manifest: Manifest,
  deps: RegistryDeps,
): string | undefined {
  for (const provider of manifest.provides ?? []) {
    if (deps.catalog && !deps.catalog.has(provider.capability)) {
      return `provides unknown capability '${provider.capability}'`;
    }
  }
  return undefined;
}

export function recordProviders(
  manifest: Manifest,
  state: RegistryIndexState,
): void {
  for (const provider of manifest.provides ?? []) {
    const peers = state.providerIndex.get(provider.capability) ?? [];
    peers.push(manifest.id);
    state.providerIndex.set(provider.capability, peers);
  }
}

export function recordShadowed(options: {
  readonly id: string;
  readonly group: Registrable[];
  readonly winner: Registrable | undefined;
  readonly shadowed: ShadowedEntry[];
}): void {
  for (const registrable of options.group) {
    if (registrable === options.winner) continue;
    options.shadowed.push({
      id: options.id,
      version: registrable.manifest.version,
      kind: registrable.manifest.kind,
      ...(registrable.manifest.trust
        && { trust: registrable.manifest.trust }),
    });
  }
}

function collectSecrets(
  declarations: NonNullable<Manifest["secrets"]>,
  supplied: Record<string, string>,
): { ok: true; secrets: Record<string, string>; } | {
  ok: false;
  why: string;
} {
  const secrets: Record<string, string> = {};
  for (const declaration of declarations) {
    const value = supplied[declaration.name];
    if (value === undefined && declaration.required !== false) {
      return {
        ok: false,
        why:
          `required secret '${declaration.name}' missing from config secrets:`,
      };
    }
    if (value !== undefined) secrets[declaration.name] = value;
  }
  return { ok: true, secrets };
}
