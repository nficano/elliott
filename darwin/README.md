# Elliott Darwin evolution layer

These images implement the language-neutral boundaries used by Elliott's
self-evolution control plane. They are not alternate orchestrators. Elliott
owns run state, datasets, hidden holdout evaluation, candidate storage,
Proposals, approval, promotion, and rollback.

## Images

| Image | Boundary | Runtime dependency |
| :--- | :--- | :--- |
| `evaluator-dspy` | GEPA and MIPROv2 text optimization | DSPy 3.2.1 and an Elliott-authorized loopback model proxy |
| `evaluator-darwinian` | Darwinian code evolution | Darwinian Evolver at `7f12365`, its corresponding AGPL source, Bun, and an Elliott-authorized loopback model proxy |
| `evaluator-agent-benchmarks` | Pre-shortlist code checks, independent sealed-dataset comparison, and Snapshot-bound regression gates | Loopback code-check, case, and benchmark executors provisioned by the placement layer |

## Layout

The tree is organized by boundary ownership:

- `runtime/` contains the shared HTTP, wire, and smoke primitives;
- `optimizers/` contains the optimizer contract, job server, supervision, and
  the DSPy and Darwinian implementations;
- `evaluators/agent-benchmarks/` contains the independent evaluator image,
  split into `benchmark/`, `candidate/`, and `evaluation/`; and
- each image owns its fixtures, dependency locks, tests, and Dockerfile.

Repeated filename qualifiers are represented by their directory. For example,
benchmark configuration is `benchmark/config.ts`, and evaluation comparison
is `evaluation/compare.ts`.

Every Darwin HTTP boundary, optimizer wire validator, candidate-envelope
builder, smoke client, and pause/resume/cancel supervisor is TypeScript running
on Bun. Only the calls into DSPy/GEPA/MIPROv2 and Darwinian Evolver remain
Python because those algorithm libraries are Python-native. A small Python
adapter receives a schema-validated request in a private job directory and
returns an untrusted raw result for TypeScript to validate and materialize.
The current boundary uses ordinary request/response HTTP. Add SSE only for
future progress streams; optimizer control operations do not require
WebSockets.

Skills may own typed client adapters, capability declarations, schemas, and
operator workflows. They must not execute untrusted candidate code in the
Elliott process. Candidate checks and benchmark drivers remain behind the
isolated executor boundary even when a skill initiates them.

The observed local OCI digests and dependency revisions are recorded in
[`images.lock.json`](./images.lock.json). The Component
manifests refer to those local digest locks. A deployment must publish the same
OCI manifests to its registry and replace each local reference with the
observed registry `RepoDigest`; it must not invent a registry name around a
local digest.

## Commands

```sh
bun run darwin:check
bun run darwin:build
bun run darwin:smoke
```

`darwin:check` runs the TypeScript benchmark/evaluator fixture suite,
Python optimizer fixture tests, process pause/resume/cancel tests, type and
syntax checks, JSON validation, source-digest verification, and
manifest-to-image-lock verification.

`darwin:build` produces native-platform OCI archives under
`.artifacts/darwin/`, loads them into the local Docker engine,
and prints each observed OCI manifest digest. Set
`ELLIOTT_DARWIN_PLATFORM=linux/amd64` or another BuildKit platform to build
for a deployment target. Rebuilds that change a manifest digest require an
intentional update to the image lock and Component manifest.

`darwin:smoke` starts the three local images with:

- no network;
- a read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- bounded CPU, memory, and process counts; and
- a bounded temporary filesystem.

It then exercises each HTTP endpoint from the image's loopback namespace.
Fixture mode never calls a model or claims a benchmark result.

## Elliott runtime binding

The consumer runtime exposes no evolution control endpoint unless an operator
principal, bearer token, and explicit capability set are configured:

```text
ELLIOTT_EVOLUTION_CONTROL_TOKEN=<runtime secret>
ELLIOTT_EVOLUTION_OPERATOR_PRINCIPAL=<principal ref>
ELLIOTT_EVOLUTION_OPERATOR_CAPABILITIES=evolution.target.read,evolution.dataset.build,evolution.engine.invoke,evolution.run.read,evolution.run.cancel,evaluation.run,proposal.author,proposal.read,proposal.approve
ELLIOTT_EVOLUTION_AGENT_CAPABILITIES=evolution.target.read,evolution.run.read
ELLIOTT_EVOLUTION_DSPY_URL=<placement-owned DSPy endpoint>
ELLIOTT_EVOLUTION_DARWINIAN_URL=<placement-owned Darwinian endpoint>
ELLIOTT_EVOLUTION_EVALUATOR_URL=<independent evaluator endpoint>
ELLIOTT_EVOLUTION_EVALUATOR_TOKEN=<scoped evaluator bearer token>
ELLIOTT_EVOLUTION_CANDIDATE_CHECK_URL=<isolated code-check endpoint>
ELLIOTT_EVOLUTION_CANARY_URL=<Snapshot-bound canary endpoint>
ELLIOTT_EVOLUTION_AUTHORING_ROUTE_DIGEST=<authoring route policy digest>
ELLIOTT_EVOLUTION_EVALUATION_ROUTE_DIGEST=<distinct judging route policy digest>
ELLIOTT_EVOLUTION_SCHEDULER_PRINCIPAL=<distinct scheduler principal>
ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES=evolution.target.read,evolution.dataset.read,evolution.engine.invoke,evolution.candidate.write,evaluation.run,proposal.author
```

Do not place provider keys in these variables. The optimizer URLs identify
placement-owned IPC routes, while model credentials remain in the scoped
broker that performs the authenticated provider request. The independent
evaluator endpoint owns holdout access; optimizer endpoints never receive
holdout case bodies. Comparison fails closed unless both route digests are
present and different.

## Independent comparison protocol

The benchmark image exposes `POST /v1/compare` as its `evaluation.runner`
boundary. Elliott creates an immutable candidate Snapshot and sends the sealed
run, candidate, and dataset with the metric definitions, statistical settings,
footprint limits, and complete benchmark ladder. A canonical plan digest binds
the request. The Darwin worker rejects an unsealed or mismatched dataset, a
candidate outside the frozen shortlist, missing constraints, incomplete broad
gates, matching author/judge routes, and plan-digest drift.

For every dataset case, the Darwin worker sends an `evaluateCase` operation to:

```text
ELLIOTT_EVALUATION_EXECUTOR_ENDPOINT=http://127.0.0.1:<port>
ELLIOTT_EVALUATION_EXECUTOR_TOKEN=<short-lived evaluation.run token>
```

The executor must resolve the requested immutable Snapshot, run only the
declared case effects, use the supplied evaluation route/environment/seed, and
return metric values with the exact case, split, and Snapshot bindings. The
Darwin worker runs paired bootstrap statistics, derives prompt/inference/runtime
footprints, executes all applicable broad gates, and returns one
`EvolutionEvaluationReport`. Elliott decodes that report and independently
rechecks every top-level, case, footprint, and gate binding before recording
it.

## Pre-shortlist code-check protocol

The benchmark image also exposes `POST /v1/candidate/check`. It revalidates the
run/candidate binding, materialized candidate digest, checkout file digests,
target-file set, non-shell command allowlist, resource limits, and absence of
network, credentials, Git remotes, active-tree writes, and runtime sockets.
Production checks are delegated to:

```text
ELLIOTT_CODE_CHECK_EXECUTOR_ENDPOINT=http://127.0.0.1:<port>
ELLIOTT_CODE_CHECK_EXECUTOR_TOKEN=<short-lived evaluation.run token>
```

The executor reconstructs the disposable checkout, applies only the candidate
target files, runs the focused reproduction and the complete `bun run check`,
and compares frozen surfaces. Its response must bind the exact run, candidate,
and digest and contain exactly `code-focused-test`, `code-full-check`, and
`code-frozen-surface`; drift or omission fails closed.

## Optimizer job protocol

The text and code images expose:

| Endpoint | Result |
| :--- | :--- |
| `POST /v1/optimize` | A completed `OptimizationEngineResult`, or a paused result with an opaque token |
| `POST /v1/pause` | An opaque resume token |
| `POST /v1/resume` | A completed or paused `OptimizationEngineResult` |
| `POST /v1/cancel` | Empty success response; cancellation is idempotent |
| `GET /healthz` | Local liveness only |

Each optimization runs in a separate process group. A time slice sends
`SIGSTOP`; resume sends `SIGCONT`; cancellation kills the process group. The
server enforces the run duration across every resume and never places a
filesystem path in the token.

The shared wire validator rejects unsupported target or engine kinds, hidden
holdout fields, mismatched dataset/run bindings, request limits above the run
budget, mismatched seeds, malformed code checkouts, digest mismatches, path
traversal, shell commands, ambient credentials, writable active trees, network
access, Git remotes, and container-runtime sockets.

## Model proxy

Production optimizer calls require these runtime values:

```text
ELLIOTT_MODEL_PROXY_ENDPOINT=http://127.0.0.1:<port>/v1
ELLIOTT_MODEL_PROXY_TOKEN=<short-lived scoped token>
ELLIOTT_DSPY_MODEL=<authorized route>
ELLIOTT_DARWINIAN_MODEL=<authorized route>
```

The endpoint must resolve to loopback and may not contain credentials, a query,
or a fragment. The token is injected at runtime; it is never accepted in an
optimization request or written to a candidate. Placement is expected to put
the proxy in the Darwin worker's network namespace and keep external provider
credentials outside the image.

Darwinian cost accounting also accepts the authorized route's input and output
USD-per-million-token rates. A proxy-reported cost takes precedence. The proxy
must enforce the same run ceiling because a provider that omits usage cannot be
made trustworthy by client-side estimates.

## Darwinian boundary

The Darwinian image is a separate distribution from Elliott's TypeScript
package. It copies the exact upstream source, license, lockfile, and build
metadata into `/usr/share/darwinian-evolver/source`, then installs that source
with its frozen `uv.lock`.

The adapter reconstructs only the sealed checkout supplied in the request.
Target files are the only mutable organism fields. Test commands execute as
argv arrays with `shell=False`, a sanitized environment, per-process resource
limits, and no network. Returned patches remain untrusted Elliott candidates;
the Darwin worker cannot author a Proposal, inspect holdout cases, approve a
release, or activate configuration.

## Benchmark executor

Terminal workloads need a sandbox service; the benchmark image deliberately
has no Docker socket. Its pinned driver sends this envelope to
`POST /v1/benchmark` on `ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT`:

```text
ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT=http://127.0.0.1:<port>
ELLIOTT_BENCHMARK_EXECUTOR_TOKEN=<short-lived evaluation.run token>
```

```json
{
  "operation": "<EvolutionBenchmarkOperation>",
  "driverSource": "<pinned upstream URL>",
  "driverRevision": "<pinned revision>"
}
```

The executor token is short-lived and loopback-scoped. The executor must:

1. resolve both immutable Snapshot IDs;
2. run the requested baseline and candidate under the supplied environment
   digest and seed;
3. enforce the timeout and cost ceiling;
4. provision Harbor and terminal sandboxes outside the evaluator container;
5. use the pinned OpenThoughts-TBLite, TerminalBench2, Harbor, or YC-Bench
   revision from `evaluators/agent-benchmarks/benchmark/drivers.json`; and
6. return a result that echoes the exact binding object plus numeric baseline,
   candidate, cost, and latency fields.

The Darwin worker rejects a result with different bindings. It derives its own
report digest from the bindings, pin, process evidence, and reported evidence.
TBLite permits the plan's two-percent regression floor. Other broad gates use
zero tolerance.

The pinned benchmark revisions are:

- OpenThoughts-TBLite `5c37b41f00ce04719a4453061076ae9f46b74b7d`
- Harbor `ff69e554fac1c751aa608e03de027db9043a2eac`
- TerminalBench2 `2fd12b88aafdd04a52c298e3940bcb189f9766d6`
- YC-Bench `e7d606789be4c52a34f9fa5b04ada4a2eaf9d731`

## Publishing

Publishing is a deployment action and is intentionally not performed by the
build command. Before enabling a published image:

1. build for every production platform;
2. run fixture smoke tests for every platform;
3. scan the OCI archive and produce an SBOM;
4. complete the Darwinian license review and make corresponding source
   available with the image;
5. push to the authorized registry;
6. record the registry-reported digest;
7. update `images.lock.json` and the matching Component manifest in
   one reviewed change; and
8. run a non-fixture staging campaign through the authorized model and
   benchmark proxies.
