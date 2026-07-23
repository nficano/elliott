import { PinnedShadowError, RegistryCollisionError } from "../errors";
import type { ComponentManifest, ComponentRef, ScopeLevel } from "../types";
import type {
  LockfileResolution,
  RegistrationOptions,
  RegistryEntry,
  RegistryResolution,
} from "./types";

const PRECEDENCE: readonly ScopeLevel[] = [
  "invocation",
  "session",
  "agent",
  "workspace",
  "user",
  "organization",
  "builtin",
];

const SECURITY_CRITICAL: ReadonlySet<string> = new Set([
  "policy",
  "evaluator",
  "gateway",
  "model-provider",
]);

const scopeKey = (entry: RegistryEntry): string =>
  `${entry.scope.level}:${entry.scope.id}`;

const byPrecedence = (left: RegistryEntry, right: RegistryEntry): number =>
  PRECEDENCE.indexOf(left.scope.level) - PRECEDENCE.indexOf(right.scope.level);

export class ComponentRegistry {
  readonly #entries = new Map<ComponentRef, RegistryEntry[]>();

  register(
    manifest: ComponentManifest,
    options: RegistrationOptions,
  ): RegistryEntry {
    const entries = this.#entries.get(manifest.ref) ?? [];
    const candidate = this.#makeEntry(manifest, options);
    if (entries.some((entry) => scopeKey(entry) === scopeKey(candidate))) {
      throw new RegistryCollisionError(manifest.ref);
    }
    this.#entries.set(manifest.ref, [...entries, candidate]);
    return candidate;
  }

  resolve(ref: ComponentRef): RegistryResolution | undefined {
    const entries = this.#entries.get(ref);
    if (entries === undefined || entries.length === 0) return undefined;
    if (this.#isPinned(entries)) return this.#resolvePinned(ref, entries);
    const sorted = [...entries].sort(byPrecedence);
    const selected = sorted[0];
    if (selected === undefined) return undefined;
    return { ref, selected, shadowed: sorted.slice(1) };
  }

  resolveManifest(ref: ComponentRef): ComponentManifest | undefined {
    const selected = this.resolve(ref)?.selected;
    return selected?.availability === "available"
      ? selected.manifest
      : undefined;
  }

  list(): readonly RegistryEntry[] {
    return [...this.#entries.values()].flat();
  }

  lockfile(): readonly LockfileResolution[] {
    const resolutions: LockfileResolution[] = [];
    for (const ref of this.#entries.keys()) {
      const resolution = this.resolve(ref);
      if (resolution === undefined) continue;
      resolutions.push({
        ref,
        selectedScope: resolution.selected.scope,
        selectedDigest: resolution.selected.manifest.digest,
        availability: resolution.selected.availability,
        shadowedScopes: resolution.shadowed.map((entry) => entry.scope),
      });
    }
    return resolutions.sort((left, right) => left.ref.localeCompare(right.ref));
  }

  #makeEntry(
    manifest: ComponentManifest,
    options: RegistrationOptions,
  ): RegistryEntry {
    const common = {
      manifest,
      scope: options.scope,
      availability: options.availability ?? "available",
      pinned: options.pinned ?? false,
    };
    return options.reason === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, reason: options.reason });
  }

  #isPinned(entries: readonly RegistryEntry[]): boolean {
    return entries.some((entry) =>
      entry.pinned || SECURITY_CRITICAL.has(entry.manifest.schema.kind)
    );
  }

  #resolvePinned(
    ref: ComponentRef,
    entries: readonly RegistryEntry[],
  ): RegistryResolution {
    const organization = entries.filter((entry) =>
      entry.scope.level === "organization" || entry.scope.level === "builtin"
    ).sort(byPrecedence);
    const selected = organization[0];
    if (selected === undefined) throw new PinnedShadowError(ref);
    const narrower = entries.filter((entry) =>
      entry !== selected
      && entry.scope.level !== "organization"
      && entry.scope.level !== "builtin"
    );
    if (narrower.length > 0) throw new PinnedShadowError(ref);
    return { ref, selected, shadowed: organization.slice(1) };
  }
}
