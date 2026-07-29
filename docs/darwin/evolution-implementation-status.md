# Elliott self-evolution implementation status

**Audit date:** 2026-07-24<br>
**Architecture:** [Elliott TDD, Revision 6](../elliott-tdd.md)<br>
**Adoption plan:** [Elliott Self-Evolution Adoption Plan](./elliott-self-evolution-adoption-plan.md)

## Result

The Elliott-native self-evolution control plane is implemented locally. It
covers all four target classes, GEPA, MIPROv2, and Darwinian optimization,
immutable datasets and candidates, hidden holdout evaluation, paired
statistics, broad gates, review-ready Proposals, canary activation, rollback,
runtime evidence collection, weak-signal triage, and operator-only release
control.

The implementation does not claim a production evolution result. The
Elliott-native control plane and its three companion images now build and run
locally. Final production acceptance still requires registry publication,
authorized model and benchmark routes, human review, and four real releases.
Those are deployment activities, not results that CI can synthesize.

## Implemented surfaces

| Plan area | Elliott implementation |
| :--- | :--- |
| Domain and state machine | `src/learning/evolution/model/`, `state.ts` |
| Protocol contracts | `src/learning/evolution/protocols.ts` |
| Effect services and Layers | `services.ts`, `layer.ts` |
| Durable stores | `store/`, `FileSnapshotStore`, durable Proposal codecs |
| Dataset sources | `datasets/sources/` plus the runtime source router in `application/dataset-sources.ts` |
| Grouping and holdout secrecy | `datasets/split.ts`, `leakage.ts`, `optimizer-view.ts` |
| Evaluation and statistics | `evaluation/`, including the durable pre-optimization baseline controller and cache |
| Required benchmark ladder | `benchmarks/required.ts`, `benchmarks/ladder.ts` |
| Skill adapter | `targets/skill.ts` |
| Tool-description adapter | `targets/tool-description.ts` |
| Typed prompt adapter | `targets/prompt-segment.ts`, `prompt-assembly.ts` |
| Code adapter and sandbox | `targets/code.ts`, `engine/isolation.ts`, `application/code-sandbox.ts`, pre-shortlist `application/code-checker.ts` |
| GEPA and MIPROv2 boundary | `skills/evaluator/dspy/` |
| Darwinian boundary | `skills/evaluator/darwinian/` |
| Independent evaluation and broad benchmark boundary | `skills/evaluator/agent-benchmarks/`, `companions/evaluators/agent-benchmarks/evaluation/` |
| Reproducible companion images | `companions/`, `companions/images.lock.json` |
| Proposal and release transaction | `release/`, including post-release regression monitoring and operator-rollback notification |
| Optional Git projection | `release/git-cli-projection.ts`, using an isolated temporary clone and effect-gating publication intent |
| Production acceptance | Schema, decoder, fail-closed auditor, and operator command in `model/acceptance.ts`, `acceptance/`, and `scripts/audit-evolution-acceptance.ts` |
| Continuous loop | `continuous/`, `src/runtime/evolution-signals.ts`, `src/runtime/evolution-scheduler.ts` |
| CLI and control plane | `cli/`, `src/cli.ts`, runtime control route |
| Agent-safe operations | `agent-operations/` |
| Consumer runtime assembly | `src/runtime/evolution.ts`, `src/runtime/snapshot.ts`, `src/runtime/conversation-snapshots.ts`, `application/` |
| Curated consumer targets | `.elliott/evolution-targets.yaml` |
| Session evidence | `src/memory/session-store/evolution.ts`, `src/runtime/evolution-evidence.ts` |
| Spans and metrics | Named `Effect.fn` workflows and `src/learning/evolution/observability/` |

## Consumer runtime adoption

The Elliott consumer process now assembles the evolution application during
normal runtime startup. It creates or reuses a secret-free immutable Snapshot,
opens the durable run, dataset, candidate, report, release, and Proposal
stores, binds the text and code optimizer routes, binds an independent
evaluator route, and installs the operator control plane and four agent-safe
tools.

The control route is absent unless all three operator authority variables are
present:

```text
ELLIOTT_EVOLUTION_CONTROL_TOKEN
ELLIOTT_EVOLUTION_OPERATOR_PRINCIPAL
ELLIOTT_EVOLUTION_OPERATOR_CAPABILITIES
```

Worker routes are separately configured with
`ELLIOTT_EVOLUTION_DSPY_URL`, `ELLIOTT_EVOLUTION_DARWINIAN_URL`, and
`ELLIOTT_EVOLUTION_EVALUATOR_URL`. Promotion additionally requires
`ELLIOTT_EVOLUTION_CANARY_URL`. Missing routes fail the relevant operation
closed; they do not select an in-process or unpinned fallback. Agent operations
use the distinct `workspace/agent/elliott` principal and receive only the
comma-separated capabilities in `ELLIOTT_EVOLUTION_AGENT_CAPABILITIES`.

Independent comparison also requires
`ELLIOTT_EVOLUTION_AUTHORING_ROUTE_DIGEST` and
`ELLIOTT_EVOLUTION_EVALUATION_ROUTE_DIGEST`. Elliott refuses equal or absent
values. Before calling the evaluator it creates a non-active immutable
candidate Snapshot and builds a canonical request that binds the sealed
dataset, both Snapshots, route policy, environment, seed, metrics, required
constraints, footprint limits, and all thirteen broad gates.

Code candidates require
`ELLIOTT_EVOLUTION_CANDIDATE_CHECK_URL`. The endpoint is the isolated
evaluator Component's `/v1/candidate/check` boundary. A code candidate cannot
enter the shortlist unless the returned, binding-checked report contains the
focused-test, full-check, and frozen-surface results.

When `continuous.enabled` is true, the runtime also requires a scheduler
principal distinct from the operator and Proposal-only capabilities:

```text
ELLIOTT_EVOLUTION_SCHEDULER_PRINCIPAL
ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES
```

The scheduler resolves that capability set again when a job fires, persists
recurrence state in `continuous.sqlite`, deduplicates jobs across restarts,
uses fresh IFC frames, serializes concurrent campaign reservations, and
enforces the configured maximum concurrent runs and monthly cost ceiling. It
loads durable performance projections, mines negative and explicit feedback,
rejects stale projection digests, ranks eligible weak targets, applies
cooldowns, and starts only the selected campaign. The selected signal IDs are
stored on the run and carried into the authored Proposal. Approval, promotion,
and rollback capabilities are rejected at startup.

Target bytes and frozen mutation surfaces are declared in
`.elliott/evolution-targets.yaml`. Elliott ships three zero-authority Skill
targets (code review, research, and debugging), one atomically evolved catalog
covering every live tool description, the typed Elliott interaction-profile
prompt, the C1 pure DuckDuckGo parser target, and a C2 DuckDuckGo tool
implementation target with explicit sealed checkouts and focused test
allowlists. Scheduler code remains outside those targets because the
architecture classifies privileged scheduling and control-plane code as C3.

Repeatable `--source` arguments accept repository-contained paths or
`golden:<path>`, `target-specific:<path>`, `synthetic[:count]`, `session`, and
`benchmark:<ref>#<task-id,...>`. With no source, a deterministic,
policy-sized target default is used. The parser target combines curated defect
reproductions in `skills/search/duckduckgo/evals/evolution.yaml` with
deterministically generated edge cases. Session sources read durable,
digest-only evidence from `sessions.sqlite`; golden source digests bind the
actual file bytes. Every route still passes through grouped leakage
validation, deterministic splitting, and holdout sealing. Synthetic
bootstraps are dataset inputs, not claimed success results.

Normal runtime turns now populate that evidence store. Elliott records run,
tool-call, component-use, feedback, selected model-route, usage, Snapshot, and
active-revision references. Tool arguments, tool results, feedback text, and
model-route identity are represented only by digests or opaque references.
Requested tools are distinguished from selected and executed tools. A call
that exercises multiple mutable components is attributed to each one, so the
DuckDuckGo parser and its tool description can accumulate separate evidence
from the same execution. Evidence-write failures remain observational and do
not fail the user turn.

Tool-description targets bind to the actual `ToolDefinition.description`
rather than their surrounding documentation. Active revisions are resolved
through the runtime catalog without editing repository files. Elliott freezes
the resolved tool definitions when a conversation begins: existing sessions
retain their original Snapshot bytes, while conversations created after
promotion see the activated description.

The typed prompt target uses the same session pinning rule. Existing
conversations retain the persona bytes captured at their first turn, while a
new conversation after promotion resolves the activated prompt revision.

The zero-authority Skill target is also consumed by the live runtime as a
prompt source. Its immutable frontmatter is preserved, and its activated body
is resolved only for new conversations. Runtime-history conversations retain
the Snapshot ID and all mutable target revisions captured on their first turn;
externally managed histories bind the active Snapshot for each turn.

Release commands now use the kernel promotion path. The consumer runtime stages
content-addressed target revisions under platform state, creates a candidate
Snapshot, requires an exact Snapshot-bound canary response, atomically advances
the active revision, bumps the workspace epoch, writes an audit cross-link, and
publishes the new Snapshot. Rollback activates the immutable parent revision
through the same transaction. A missing or failed canary leaves the active
revision unchanged. Elliott never treats a file copy, companion response, or
Git push as activation.

Before optimization, Elliott now runs validation and sealed holdout cases
against the active Snapshot through the independent evaluator. The immutable
baseline report retains case outcomes, metrics, trajectory digests, all three
footprints, cost, latency, route digests, environment, dataset digests, and
seed. Optimizer invocation is awaited until that report has been bound,
persisted, and recorded; baseline results are never added to the optimizer
request.

Recurring benchmarks for an active release feed a lineage-bound post-release
monitor. The monitor compares success, broad benchmark, and cost measurements
with the stored pre-optimization and comparison baselines, persists an
immutable report, and records and notifies
`operator-rollback-required` on regression. It deliberately has no rollback
capability; an authorized operator must invoke the existing immutable rollback
transaction.

Optional Git publication is a projection only. The production adapter clones
the configured repository into an isolated temporary directory, rejects
unsafe Proposal IDs, paths, symlinks, special files, and existing remote
branches, commits only the immutable Proposal bundle, and pushes a new
`elliott/evolution/<proposal-id>` branch. The publication cannot begin until
its effect-gating audit Record is durable, and it never changes active Elliott
state.

Production completion is now mechanically auditable without weakening any
gate. A schema-v2 manifest captures external deployment evidence and the four
required production campaigns. `bun run evolution:acceptance` validates that
evidence and recomputes every claimed lineage from Elliott's durable releases,
runs, sealed datasets, materialized candidates, independent reports, approved
Proposals, and baseline/evaluation/release/rollback Snapshots. No passing
manifest is committed here because local fixtures cannot substitute for
production evidence. See
[the production acceptance handoff](./evolution-production-acceptance.md).

## Safety properties now enforced

- Optimizers receive train and validation cases only. Holdout case bodies and
  expected results are absent from the optimizer wire schema.
- Runs retain the dataset ID, dataset digest, optimization seed, configuration
  digest, baseline Snapshot, target digest, and budgets.
- Dataset manifests are rechecked for split digests, overall digest,
  classification, leakage, and holdout sealing before attachment.
- Candidate bytes, datasets, reports, Snapshots, Proposal artifacts, and
  releases use durable or immutable stores.
- Evaluation rejects mismatched run, candidate, dataset, target, case, split,
  route, or Snapshot bindings.
- The shipped `evaluation.runner` endpoint executes paired cases only through a
  bearer-protected loopback `evaluation.run` executor. It validates shortlist,
  dataset, constraint, route, plan-digest, and complete-ladder bindings before
  execution, then computes fitness, paired bootstrap statistics, footprints,
  and broad-gate aggregation inside the isolated evaluator Component.
- Elliott independently validates the returned report against every
  top-level request field, ordered case/Snapshot binding, benchmark reference,
  and required footprint category before persisting it.
- Engine IPC rejects malformed, oversized, negative-usage, wrong-run, and
  wrong-target results.
- Optimizer-supplied constraint claims are not trusted. Elliott derives
  candidate byte/digest, baseline, path containment, frozen-frontmatter,
  footprint, and target-surface constraints before shortlisting. Prompt trust
  and source preservation are derived from frozen typed metadata plus a static
  authority-drift check. Code execution and frozen-surface results must come
  from the separately configured isolated checker and fail closed when absent.
- Trusted code validation also rejects newly introduced unsafe casts or
  suppressions, process access, unbounded loops, network destinations, removed
  security or error-handling markers, and removed public exports before the
  isolated checker is invoked.
- Engine requests carry candidate, token, cost, duration, and concurrency
  ceilings. Duration exhaustion cancels the engine request and records a
  terminal budget state.
- Darwinian requests require a candidate-only checkout, relative target paths,
  digest-verified checkout bytes, non-shell test commands, positive resource
  limits, no network, no repository credentials, no Git remote, no active-tree
  write, and no container-runtime socket.
- The code-check companion independently revalidates the checkout and
  materialized candidate digest, requires exactly the three pre-shortlist code
  constraints, and accepts production results only from a bearer-protected
  loopback sandbox executor.
- Companion request limits cannot exceed the signed run budgets. Dataset IDs,
  digests, target digests, engine kinds, and optimization seeds must match the
  run.
- Text optimizer workers cannot receive holdout cases. GEPA and MIPROv2 use
  only train/validation examples and a short-lived loopback model route.
- Optimizer pause, resume, duration enforcement, and cancellation operate on a
  separate process group rather than an in-memory status flag.
- Benchmark workers require the exact baseline and candidate Snapshot IDs,
  environment digest, seed, timeout, and cost ceiling. Driver results must
  attest those bindings before Elliott accepts the aggregate.
- Promotion requires a matching approved Proposal, independent evaluation,
  paired holdout statistics, every required gate, all three footprint
  categories, fresh target state, separated author/approver/promoter roles, and
  `release.promote`.
- Canary, failed, active, rollback, Proposal, candidate, and report records are
  immutable. A canary is persisted before execution; activation creates a
  separate active release.
- Rollback activates a prior immutable revision and tracks the prior target
  digest separately from its configuration revision digest.
- Scheduled automation may detect, build, optimize, evaluate, and author a
  Proposal. Its API has no approval, promotion, or rollback authority.
- Completed comparisons update durable target performance projections. Live
  scheduling rejects projections bound to a stale target digest and records
  signal detection, cooldown, budget, regression, run-complete, and
  Proposal-ready events without acquiring release authority.

## Verification

The repository-wide command completed successfully:

```text
bun run check
```

Observed repository-gate result:

- TypeScript typecheck: passed.
- ESLint: passed.
- dprint formatting check: passed.
- Bun tests: 224 passed, 0 failed across 74 files.
- Companion tests: 19 passed, 0 failed.
- G1 through G25: passed.
- SE1 through SE15: named coverage present and passed.
- Footprint check: passed.
- Rust hot-core tests: 2 passed, 0 failed.

The separately executed companion build and smoke gates also passed:

- Companion TypeScript lint/type checks and Python adapter tests: passed.
- Native Linux ARM64 OCI builds: 3 passed.
- No-network, read-only, capability-dropped HTTP endpoint smokes: 6 passed.

The test suite includes a complete fixed-candidate workflow, restart
durability, failed-canary containment, rollback history, conversation Snapshot
pinning, digest-only runtime evidence, live weak-signal selection, recurring
scheduler recovery, schema-bound engine smoke tests, cross-language wire
fixtures, real process pause/resume/cancel, trusted code guards, and
deterministic property/fuzz corpora.

## Local companion image evidence

| Image | Observed OCI manifest digest |
| :--- | :--- |
| DSPy evaluator | `sha256:20dda80b74813bacf606f581c6fc31736d2eb4c3740cae3db7bf785a48a10c04` |
| Darwinian evaluator | `sha256:462ca94d9682b15ac6fb31a31db705f792f7d51855947f748c11a66da08bac52` |
| Independent, code-check, and broad-gate evaluator | `sha256:3481a985ade2c8696fd2ad0de1a0224d3cc54ce725dc6e5c19d0ad6fcd6dd34c` |

The build lock records source digests, dependency locks, upstream revisions,
artifact paths, platform, and smoke status. CI rejects source changes that are
not followed by a rebuild and lock update. Darwinian's image contains its exact
upstream source, license, and frozen dependency lock at
`/usr/share/darwinian-evolver/source`.

## External production prerequisites

These items must be completed in the deployment environment before enabling
evolution:

1. Scan the three local OCI archives, build any additional production
   platforms, publish them to the organization's registry, and replace the
   local references with registry-reported digests.
2. Complete organizational legal approval for the separate Darwinian AGPL
   distribution. Publish its complete corresponding source and notices with
   the image. Follow [the license review](./darwinian-evolver-license-review.md).
3. Provision the bearer-protected loopback code-check, Snapshot case, and
   benchmark executors. The code checker must reconstruct the sealed candidate
   checkout, run the focused reproduction and full `bun run check`, compare
   frozen surfaces, and return digest-bound evidence before shortlisting. The
   case executor must resolve immutable Elliott Snapshots and
   execute schema-bound holdout cases on the distinct judge route. The
   benchmark executor must run the pinned OpenThoughts-TBLite, Harbor,
   TerminalBench2, and YC-Bench revisions in external terminal sandboxes
   without mounting a container-runtime socket into the evaluator.
4. Bind short-lived, policy-authorized model routes for candidate authoring and
   a distinct route for holdout judgment. Do not place provider secrets in an
   evolution request, dataset, trace, Proposal, or candidate image.
5. Configure benchmark datasets and any required model credentials under the
   deployment's classification, residency, cost, and egress policy.
6. Run the four acceptance campaigns: one skill, one tool-description catalog,
   one typed prompt segment, and one C1 or C2 isolated component. The code
   campaign must use the deployment's immutable build-and-restart path; Elliott
   does not hot-swap executable code into the active process.
7. Retain the resulting dataset manifests, reports, Proposals, approvals,
   releases, Snapshots, epoch changes, and rollback records.
8. Provision the Snapshot-bound canary route and verify it runs the deployment's
   deterministic health and behavioral checks. The runtime activation,
   Snapshot, epoch, audit, and immutable rollback transaction is already bound;
   absent canary evidence fails promotion before activation.

The three image references currently committed in the evaluator manifests are
observed local OCI locks and resolve in the build environment. They are not
registry publications. A production deployment must replace them with digests
reported by its authorized registry; wrapping a local digest in an invented
registry name is not valid publication evidence.

## Production acceptance sequence

For each target class:

1. Resolve the active target and baseline Snapshot.
2. Build and seal a policy-sized dataset.
3. Establish baseline validation and holdout results.
4. Optimize through the isolated engine Component.
5. Freeze the shortlist.
6. Evaluate with the independent route.
7. Run every applicable deterministic and broad gate.
8. Author a Proposal and inspect the permission delta first.
9. Obtain the required human review and approval.
10. Promote through canary and transactional activation.
11. Confirm that only new sessions use the new Snapshot.
12. Exercise rollback and retain both release histories.

Production adoption is complete only after all four releases finish this
sequence and the deployment's
`bun run evolution:acceptance -- <manifest> <runtime-state-root>` report
passes. CI fixtures prove the control-plane laws; they do not substitute for
those releases.
