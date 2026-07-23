// Capability Broker — TDD §1a, §8. Every brokered call: load cached grant
// resolution, compare epoch vector (a handful of atomic reads), serve on
// match; on mismatch re-resolve synchronously. A revoked handle fails with
// GrantRevokedError. Caches never widen authority (§0d).
//
// Deferred to M5: brokered invocation path, deferred-grant JIT approval, streamed
// tool-call incremental inspection (§8a).

export {};
