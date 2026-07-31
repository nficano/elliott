# Elliott self-evolution completion audit

**Audit date:** 2026-07-24<br>
**Architecture authority:** [Elliott TDD, Revision 7](../elliott-tdd.md)<br>
**Adoption authority:** [Elliott Self-Evolution Adoption Plan](./elliott-self-evolution-adoption-plan.md)

## Verdict

The Elliott-native implementation and its local conformance evidence are
complete enough to run the planned workflow, but the plan's definition of full
adoption is not yet satisfied. The repository-wide gate passes, all G1–G25 and
SE1–SE15 tests pass locally, the three isolated Darwin images build and
smoke, and the four target adapters are connected to the consumer runtime.

Full adoption still requires deployment-controlled facts that this repository
cannot manufacture: authorized production routes and executors, image
publication and scanning, Darwinian distribution approval, human decisions,
measured stage thresholds, and four production releases with retained
lineage. Those are acceptance work, not waived gates.

Status terms used below:

- **Proven locally:** direct executable evidence exists in this checkout.
- **Implemented, production proof pending:** the path exists and fails closed,
  but needs a real deployment campaign or external service.
- **Not complete:** required implementation or evidence is still absent.

## Roadmap audit

| Stage | Local status | Direct evidence | Remaining acceptance evidence |
| :--- | :--- | :--- | :--- |
| 0 — control plane | Proven locally | Evolution schemas, state machine, durable stores, Proposal codec, `FileSnapshotStore`, release transaction, config decoder, services/Layers, runtime control route, promotion and rollback tests | Production operator authority, registry-backed immutable artifacts, production activation audit |
| 1 — evaluation substrate | Proven locally; external runners pending | Session evidence, deterministic classified datasets, Snapshot-bound harness, baseline reports, statistics, budgets, pause/resume/cancel, thirteen-gate ladder, CLI/control plane | Real TBLite, TerminalBench2, YC-Bench, Harbor, case-executor, and restricted-route runs |
| 2 — Skills | Implemented, production proof pending | Skill adapter, GEPA/MIPROv2 workers, three installed zero-authority Skills, skill datasets and constraints, session-pinned activation | Three real campaigns and one measured ≥10% primary holdout improvement with broad-gate acceptance |
| 3 — tool descriptions | Implemented, production proof pending | Atomic live catalog target, 200-case cross-tool default, confusion mining, exact key/schema freeze, one-Snapshot activation | Measured ≥5% global holdout gain and protected per-tool production results |
| 4 — typed prompts | Implemented, production proof pending | Typed prompt adapter, frozen purpose/trust/security metadata, behavioral scenarios, full-prompt constraints, cache/Snapshot pinning | Measured ≥10% targeted gain, zero broad regression, independent style/identity evidence |
| 5 — code | Implemented, production proof pending | Pinned Darwinian boundary, C1 parser and C2 tool targets, candidate-only sandbox, static guards, isolated code checker, focused tests | Legal approval, production image distribution, one C1 then one C2 campaign, known-defect holdout success, human line review, immutable build/restart |
| 6 — continuous loop | Proven locally for Proposal-only fixtures; production proof pending | Durable recurring benchmark and campaign jobs, fresh frames, fire-time authority, deduplication, budgets/backoff, live signals, Proposal-only workflow, post-release monitor | Enabled production scheduler, live notification sink, authorized benchmark routes, observed unattended Proposal |

## Architecture and workflow evidence

| Requirement | Status | Evidence |
| :--- | :--- | :--- |
| Schema-backed domain and typed failures | Proven locally | `src/learning/evolution/model/`, `errors.ts`, store codecs, wire decoders |
| Protocol-based extension without new kinds | Proven locally | `protocols.ts`; evaluator Components implement optimization, evaluation, benchmark, and projection contracts |
| Immutable baseline, candidate, dataset, report, release, and monitor artifacts | Proven locally | `store/`, `FileSnapshotStore`, immutable writes and restart tests |
| Pre-optimization baseline | Proven locally | `evaluation/baseline.ts`, `/v1/baseline`, baseline cache/store, application ordering test, container smoke |
| Hidden holdout | Proven locally | Optimizer view omits holdout; evaluator receives sealed dataset after shortlist; SE5/SE6 evidence |
| Independent author and judge routes | Proven locally as a fail-closed contract | Baseline/comparison bindings reject absent or equal route digests; production routes are not configured here |
| Pareto shortlist | Proven locally | Validation quality, materialized footprint, cost, and latency frontier in `candidates/pareto.ts` |
| Full benchmark ladder | Proven locally as adapters and fixtures | Thirteen locked gates and isolated runner boundary; real external benchmark execution is pending |
| Human review and promotion separation | Proven locally | Proposal author/reviewer/promoter checks, C3/C4 two-reviewer policy, operator-only control route |
| Snapshot-only activation and session pinning | Proven locally | Release runtime, epoch transaction, conversation Snapshot tests |
| Canary and rollback | Proven locally as transaction law | Canary-before-activation and immutable rollback tests; production canary endpoint is pending |
| Post-release monitoring | Proven locally | `release/monitor.ts`, immutable monitor store, regression notification test; scheduler cannot roll back |
| Optional Git projection | Proven locally | `release/git-cli-projection.ts` publishes only an immutable Proposal bundle from an isolated clone; the local-bare-remote integration test proves successful publication and durable-intent failure containment |
| Production acceptance contract | Proven locally; production evidence absent | Schema-v2 `model/acceptance.ts`, `acceptance/`, and `bun run evolution:acceptance` reject malformed, incomplete, missing, or altered evidence and recompute all four lineages from durable releases, runs, datasets, candidates, reports, Proposals, and Snapshots |
| Evolution metrics listed in §16.2 | Proven locally | `observability/metrics.ts` exports run/candidate outcomes, rejection reasons, fitness/broad deltas, token/cache/cost/latency/engine time, queue/active time, Proposal/canary rates, tool-confusion, dataset, and monthly-budget instruments |

## G1–G25 audit

Every TDD gate has a dedicated conformance test and passed in the
2026-07-24 `bun run check` execution.

| Gates | Test evidence | Status |
| :--- | :--- | :--- |
| G1–G5 | `g01-kind-integrity`, `g02-residency-consistency`, `g03-manifest-runtime`, `g04-isolation-placement`, `g05-org-pinning` | Proven locally |
| G6–G10 | `g06-grant-revocation`, `g07-memory-classification`, `g08-profile-completeness`, `g09-g10-routing` | Proven locally |
| G11–G15 | `g11-selection-audit`, `g12-broker-integrity`, `g13-prompt-cache`, `g14-sanitizer-governance`, `g15-sanitizer-audit` | Proven locally |
| G16–G20 | `g16-audit-integrity`, `g17-epoch-coherence`, `g18-route-equivalence`, `g19-sanitizer-cache`, `g20-audit-durability` | Proven locally |
| G21–G25 | `g21-topology-container`, `g22-posture-monotonicity`, `g23-secret-stream-containment`, `g24-gateway-ingress`, `g25-scheduler-authority` | Proven locally |

## SE1–SE15 audit

| Gate | Status | Principal evidence |
| :--- | :--- | :--- |
| SE1 target binding | Proven locally | Stale target rejection in state, Proposal, scheduler, and promotion paths |
| SE2 Snapshot isolation | Proven locally | Paired harness and conversation pinning tests |
| SE3 authority separation | Proven locally | Distinct optimizer/evaluator/author/reviewer/promoter principals |
| SE4 candidate containment | Proven locally | Path fuzzing, frozen surfaces, candidate-only checkout |
| SE5 holdout secrecy | Proven locally | Optimizer schema/view omit holdout; evaluator-only grant |
| SE6 reproducibility | Proven locally | Sealed datasets, routes, environment, seed, plan digests, baseline/candidate trajectories |
| SE7 constraint completeness | Proven locally | Required constraints fail closed before shortlist/promotion |
| SE8 statistics | Proven locally | Paired bootstrap effect, interval, samples, regression floor, correction |
| SE9 footprints | Proven locally | Prompt, inference, and runtime gates |
| SE10 engine isolation | Proven locally | Digest-pinned local OCI locks, schema-backed HTTP/process boundaries |
| SE11 durable promotion | Proven locally | Intent before effect, Snapshot, epoch bump, audit cross-link |
| SE12 no direct deployment | Proven locally | Agent/scheduler operations end at Proposal; no approval/release tools |
| SE13 code safety | Proven locally | Frozen privileged surfaces and isolated checker |
| SE14 continuous freshness | Proven locally | Fresh frame, fire-time authority, leases, budgets, backoff |
| SE15 rollback integrity | Proven locally | New immutable rollback release; history remains unchanged |

## Definition-of-full-adoption audit

| §19 item | Status | What closes it |
| :--- | :--- | :--- |
| 1. GEPA, MIPROv2, Darwinian isolated Components | Implemented, production proof pending | Publish/scan images and execute each against authorized routes |
| 2. Four adapters produce review-ready Proposals | Proven locally with deterministic workflows; production proof pending | Retain one real Proposal per target class |
| 3. All five dataset sources | Proven locally | Synthetic, session, golden, benchmark, and target-specific integration tests |
| 4. Holdout, statistics, fitness, full checks, broad benchmarks, footprints, canaries | Implemented, production proof pending | Real external benchmark/canary reports and stage thresholds |
| 5. Proposal→approval→promotion→Snapshot→epochs→audit→rollback | Proven locally | Fixed-candidate and runtime-release tests; real human/deployment evidence pending |
| 6. Scheduler weak-target→Proposal unattended | Proven locally with seeded/live-store evidence | Observe one enabled production cycle |
| 7. Scheduler cannot approve/promote | Proven locally | Startup rejection and operation/capability surface tests |
| 8. G1–G25 and SE1–SE15 pass in CI | Proven in the local repository gate | Preserve the same result in the deployment's CI |
| 9. Four production releases | Not complete | Skill, atomic tool catalog, typed prompt, and isolated code releases with retained lineage |

## Current verification record

`bun run check` completed successfully on 2026-07-24:

- TypeScript, ESLint, and dprint: passed.
- Bun: 224 tests passed, 0 failed across 74 files.
- Companion workers: 19 tests passed, 0 failed.
- Footprint gate: passed.
- Rust hot core: 2 tests passed, 0 failed.
- G1–G25 and SE1–SE15: passed.

The Linux ARM64 Darwin build and hardened fixture smokes also passed:

| Component | OCI manifest digest |
| :--- | :--- |
| DSPy GEPA/MIPROv2 | `sha256:83644cc6c9bdcf08bd5c8b1f47f76eb2bab4eafefb2f75b7214ce30eb5b26a3e` |
| Darwinian | `sha256:c6cfd9830f0b91a8e1879c0d18ae97ea42f08b80a136baa54b146252c02bf297` |
| Independent evaluator/benchmarks/code checker | `sha256:f71445244f0a74512cd92f1d9d62355052c3ea82c26e3b0ca7f1c97057cc4245` |

These are observed local OCI artifacts. The lock explicitly records
`distribution: local-oci` and `publishedRegistry: null`.

## Blocking production acceptance

The following exact evidence is absent and must not be inferred from fixtures:

1. Registry publication, multi-platform build as required, vulnerability
   scanning, and deployment verification of all three Darwin images.
2. Organizational approval for distributing Darwinian under AGPL-3.0,
   including corresponding source and notices.
3. Bearer-protected loopback candidate-check, evaluation-case, broad benchmark,
   and canary executors with immutable Snapshot resolution.
4. Distinct authorized model-author and model-judge routes plus compliant
   datasets, credentials, egress, residency, and cost policy.
5. Human review and approval Records.
6. Measured stage success thresholds.
7. Four production releases and rollback drills with retained datasets,
   reports, Proposals, Snapshots, epochs, audit links, and release lineage.

Until those seven evidence groups exist, §19 remains open even though the
local implementation gate is green. The required groups are now represented
by the schema-v2 manifest documented in
[Evolution production acceptance](./evolution-production-acceptance.md); the
auditor recomputes retained Elliott lineage and cannot turn local fixture
evidence into a passing production report.
