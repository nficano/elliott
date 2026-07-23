// Epoch-invalidated grant resolution — TDD §1a. Fast path: load cached
// entry, compare epoch vector, serve on match; mismatch re-resolves on the
// same call. Limit *consumption* is never cached, only resolved limits.
//
// Deferred to M5: seven-source intersection + five-source minimum, grants.explain.

export {};
