# Darwinian code optimizer

External CLI boundary for Darwinian Evolver. Its image and license stay
separate from Elliott. Each invocation receives one disposable candidate
checkout, an explicit target file set, and an allowlisted test command.

The checkout has no Git remote, repository credentials, host mount,
container-runtime socket, or network egress. Returned patches are untrusted and
must pass Elliott containment, frozen-surface, full-check, benchmark, review,
canary, and Proposal gates.

The separate image contains the exact pinned upstream AGPL source and license.
It reconstructs the checkout from digest-verified request bytes, permits
mutation only for `targetFiles`, executes tests without a shell, and returns
candidate lineage. Its model access is a short-lived route through a loopback
proxy; provider credentials never enter the request or image.
