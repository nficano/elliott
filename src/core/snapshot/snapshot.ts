// Immutable runtime snapshots — TDD §2 (design principle 5), §11b. Every run
// resolves against one fixed Snapshot; mid-run changes apply only to future
// Snapshots. Revocation still bites mid-run via epochs (§1a).
//
// Deferred to M0: snapshot construction from a resolved registry + activated config.

export {};
