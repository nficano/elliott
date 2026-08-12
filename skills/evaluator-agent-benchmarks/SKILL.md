---
name: evaluator-agent-benchmarks
description: Isolated benchmark runner and independent evolution evaluator that owns the hidden comparison route and broad benchmark ladder. Use when scoring or baselining candidate components against sealed holdout data.
---

# Independent evolution evaluator and broad benchmark runner

This isolated Component owns the hidden comparison route and the broad
benchmark ladder. Elliott sends a schema-validated, Snapshot-bound comparison
request only after sealing the shortlist. The request binds the complete sealed
dataset, authoring and judging routes, environment, seed, metric plan,
constraints, footprint limits, and every required benchmark gate. The
companion returns a case-level comparison report; Elliott independently checks
every binding before accepting it.

Before optimization begins, `POST /v1/baseline` evaluates only the validation
and sealed holdout splits against the active Snapshot. It stores case outcomes,
trajectory digests, metrics, prompt/inference/runtime footprints, cost,
latency, route digests, environment, and seed without exposing those results
to an optimizer.

Terminal sandboxes are provisioned by a loopback benchmark executor, not by
mounting a container-runtime socket. Every driver result must attest the exact
baseline Snapshot, candidate Snapshot, environment digest, seed, timeout, and
cost ceiling. The adapter pins OpenThoughts-TBLite, Harbor, TerminalBench2, and
YC-Bench revisions and derives its own report digest.

Case execution is likewise delegated through the bearer-protected
`/v1/evaluation/case` capability route configured by
`ELLIOTT_EVALUATION_EXECUTOR_ENDPOINT`. The evaluator can read sealed holdout
cases, while optimizer Components cannot. It never receives candidate-authoring
credentials and refuses to judge when the authoring and evaluation route
digests match.

Before a code candidate can enter the shortlist, the same isolated boundary
accepts `POST /v1/candidate/check`. It verifies the sealed checkout and
candidate digest, then delegates to a bearer-protected loopback code-check
executor. The returned report must attest the exact run, candidate, and digest
and include focused-test, full `bun run check`, and frozen-surface results.
