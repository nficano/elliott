// Kernel-enforced residency — TDD §4a. Locality is assigned and enforced by
// the kernel via ResidencyGrants (egress policy derived from the container's
// network namespace), never read from provider catalogs. A catalog claiming
// `local` while holding external egress fails registration (G2).
//
// Deferred to M4/M5: ResidencyGrant binding at registration + egress probes (§12b).

export {};
