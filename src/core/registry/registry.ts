// Component registration and discovery — TDD §3. Filesystem discovery is
// authoritative; runtime code is never imported during discovery. Resolution
// order: invocation > session > agent > workspace > user > organization >
// builtin, inverted for org-pinned SecurityCriticalKind components.
//
// Deferred to M0/M2: manifest scanning, validation caching by package digest (§3a),
// quarantine-on-mismatch (G3), shadowing visibility in the lockfile.

import type { ComponentManifest, ComponentRef } from "../types";

export class ComponentRegistry {
  private readonly manifests = new Map<ComponentRef, ComponentManifest>();

  register(manifest: ComponentManifest): void {
    if (this.manifests.has(manifest.ref)) {
      throw new Error(`Same-scope collision for ${manifest.ref}`);
    }
    this.manifests.set(manifest.ref, manifest);
  }

  resolve(ref: ComponentRef): ComponentManifest | undefined {
    return this.manifests.get(ref);
  }

  list(): readonly ComponentManifest[] {
    return [...this.manifests.values()];
  }
}
