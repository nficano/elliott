// ComponentInstance lifecycle — TDD §1, §2. Legal transitions:
// created→opening→open→draining→closed; any state→failed. The kernel releases
// the GrantHandle on entry to closed or failed.
//
// Deferred to M0: kernel-enforced lifecycle state machine + IPC transport contract.

export {};
