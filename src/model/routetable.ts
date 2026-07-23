// Route tables — TDD §5d "table build (event time)". Rebuilt on config
// activation, epoch bump, catalog digest change, health transition, or
// ResidencyGrant change; never consulted stale (a stale table forces a
// synchronous rebuild of that key on the calling request).
//
// Deferred to M4: build from profile bindings (§5c), ceilings, ResidencyGrants,
// capability sets, and health flags; intern capability sets.

export {};
