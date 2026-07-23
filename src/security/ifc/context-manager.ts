// ContextManager — TDD §6a. The kernel sets frame classifications, not the
// agent: a frame is the max of all data wired into it, raised at read time.
// No agent-writable path lowers a mark; lowering is sanitizer-only (§7).
//
// Deferred to P2: frame stack, fork/merge, optimistic concurrency (§6c).

export {};
