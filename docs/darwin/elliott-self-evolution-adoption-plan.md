# Elliott Self-Evolution Adoption Plan

**Status:** Implementation plan<br>
**Target:** Elliott framework and its Elliott consumer agent<br>
**Elliott architecture source:** [Technical Design Document, Revision 6](../elliott-tdd.md)<br>
**Upstream source:** [Hermes Agent Self-Evolution `PLAN.md` at commit `0a929e3`](https://github.com/NousResearch/hermes-agent-self-evolution/blob/0a929e3aa20e15cf04dc7c28492a7d41a5139125/PLAN.md)<br>
**Source review date:** 2026-07-23

## 1. Outcome

Elliott will support the complete Hermes self-evolution workflow for four target classes:

1. Agent Skills instruction text.
2. Tool and operation descriptions.
3. Governed prompt segments and interaction profiles.
4. Executable component code.

Elliott will support all three upstream optimization engines:

- DSPy with GEPA as the primary text optimizer.
- DSPy MIPROv2 as the fallback text optimizer.
- Darwinian Evolver as an external CLI for code candidates.

The implementation will also support synthetic, session-derived, golden, benchmark-derived, and target-specific evaluation data; task-specific fitness; broad regression benchmarks; continuous target triage; scheduled optimization; candidate lineage; human review; canary activation; and rollback.

Elliott will implement those features through its Component, Protocol, Record, Proposal, Snapshot, Grant, scheduler, placement, and audit systems. An optimizer will never receive direct authority to edit an active component or activate a release.

## 2. Architectural decisions

These decisions resolve differences between the upstream Hermes plan and Elliott's TDD.

### 2.1 Elliott owns orchestration

The TypeScript control plane will live under `src/learning/evolution/`. Elliott will represent optimization engines, dataset builders, benchmark runners, and judges as Components with schema-backed Protocols. The implementation will not add a second plugin model or a privileged "evolution manager."

### 2.2 Python engines run outside the kernel

DSPy, GEPA, and MIPROv2 need Python. Elliott will run them in a digest-pinned companion or remote worker behind the normal component IPC contract. The kernel will send typed requests and receive typed candidate results. Python code will not load into the kernel process.

This design respects the TDD's language-neutral IPC seam and keeps Elliott's framework implementation in TypeScript.

### 2.3 Darwinian Evolver remains an external CLI

Elliott will execute Darwinian Evolver in its own digest-pinned container through a brokered component operation. No Elliott package will import or link its AGPL code. The component will receive a disposable candidate checkout, a bounded task, an evaluation command allowlist, and resource limits.

The implementation phase must include a license review before Elliott publishes an image or distribution that contains Darwinian Evolver.

### 2.4 Proposals remain the source of control-plane truth

The upstream plan uses a Git branch and pull request as its deployment boundary. Elliott will use the TDD's Proposal directory and immutable configuration revision as the authoritative boundary.

An optional Git projection may create a branch and pull request for review. A Git merge will not activate a candidate. `ReleasePromoter` will activate an approved Proposal through `ConfigurationActivationManager`, produce a new Snapshot, bump affected epochs, and retain rollback metadata.

### 2.5 Optimizers write only to candidate storage

Every run will bind to:

- One target component reference.
- One active target digest.
- One baseline Snapshot.
- One dataset manifest digest.
- One optimization configuration digest.

Optimizers will write candidate bytes to a content-addressed run directory. They will have no write path to active component directories, policy files, lockfiles, Proposal approval state, Snapshot state, or audit storage.

### 2.6 Every evaluation uses an immutable Snapshot

Baseline and candidate evaluations will run in clean frames against explicit Snapshots. Candidate Snapshots may refer to a temporary component revision, but each evaluation case will keep one Snapshot from start to finish. Elliott will never hot-swap a skill, tool schema, prompt segment, or executable module into an active conversation.

### 2.7 Benchmarks remain regression gates

Task-specific evaluation will produce fitness. Elliott's full checks and broad agent benchmarks will reject regressions. They will not guide the optimizer directly.

### 2.8 Full adoption keeps every phase

The rollout may pause at a failed phase gate, but it will not skip the remaining target classes. Elliott reaches full adoption only after code evolution and the continuous loop pass their gates.

### 2.9 The engines optimize artifacts, not model weights

Elliott will mutate prompt text, examples, descriptions, and source code. It will not use DSPy `BootstrapFinetune`, train model weights, or require GPUs. Optimization and evaluation will use ordinary model inferences through Elliott's provider-neutral routing.

## 3. Upstream-to-Elliott mapping

| Upstream concept | Elliott implementation |
| :--- | :--- |
| `batch_runner.py` | Snapshot-bound `EvaluationHarness` in `src/learning/evolution/evaluation/`, using the agent loop and broker |
| `agent/trajectory.py` | Immutable Records plus an `EvolutionTraceProjection` that reconstructs case trajectories |
| `SessionDB` | `SessionStore`, extended with run, tool-call, component-use, feedback, and outcome records |
| `skills/` | Any discovered `skill` Component and its `SKILL.md`; bundled or consumer-scoped |
| Tool registry descriptions | Model-visible Component cards, operation schemas, and `ToolDefinition` descriptions bound to component digests |
| Prompt builder sections | Typed `PromptSegment` sources and InteractionProfile Components |
| Git history | Candidate lineage Records, Proposal artifacts, release digests, and optional Git projection |
| GEPA | External evaluator Component implementing `optimization.engine` |
| MIPROv2 | Fallback operation on the DSPy optimizer Component |
| Darwinian Evolver | External evaluator Component implementing `optimization.engine` with a code-only target contract |
| TBLite | External benchmark adapter run against the Elliott consumer agent |
| TerminalBench2 | Final code-candidate benchmark adapter |
| YC-Bench | Long-horizon and prompt-coherence benchmark adapter |
| Cron loop | Elliott scheduler with fresh frames and authority resolution at fire time |
| PR approval | Proposal review plus an optional PR review projection |
| Git revert | Activation of a previous immutable revision through the same promotion transaction |

## 4. Current Elliott baseline and gaps

Elliott already has the control-plane skeleton required by this plan. The implementation must extend it rather than replace it.

| Area | Existing base | Gap to close |
| :--- | :--- | :--- |
| Signals | `src/learning/signals/` implements the TDD's six-level signal ranking | No production ingestion from user corrections, tool failures, benchmark results, or run outcomes |
| Proposals | `FileProposalStore` creates the TDD Proposal directory | Updates are memory-only; artifacts do not yet include candidates, datasets, lineage, statistics, or benchmark reports |
| Evaluation | `ProposalEvaluator` enforces the ordered TDD stage list | `ProposalStageRunner` has no production runner or snapshot-bound harness |
| Promotion | `approveProposal`, `promoteProposal`, and `ConfigurationActivationManager` enforce author separation and target staleness | No release builder connects candidate bytes, lockfile updates, Snapshot creation, canary instances, epochs, and rollback |
| Snapshots | `SnapshotStore` creates immutable in-memory Snapshots | Evolution needs durable candidate Snapshots and baseline/candidate pairing |
| Sessions | `SessionStore` records sessions, messages, model usage, and jobs | It does not record skill activation, tool selection, tool arguments, outcomes, user corrections, or evaluation labels |
| Scheduler | The scheduler leases jobs, resolves current authority, and creates a fresh frame | It needs recurring schedules, evolution-specific budgets, cancellation, and run deduplication |
| Prompt model | `PromptSegment` and `assemblePrompt` implement typed ordering and a stable prefix | Prompt sources do not expose targetable segment boundaries or preservation constraints |
| Footprints | `FootprintTracker` separates prompt, inference, and runtime footprints | It needs baseline/candidate comparison per evolution run |
| Components | The ontology includes the `evaluator` kind | The bundled loader does not accept `evaluator` or `EVALUATOR.md`, and no optimizer Component exists |
| Agent Skills | `loadAgentSkill` parses standard `SKILL.md` with a separate authority overlay | No target adapter can mutate the instruction body while freezing frontmatter and overlay authority |
| Runtime tools | `RuntimeModelClient` emits tool descriptions and schemas | No digest-bound description catalog or cross-tool selection evaluator exists |
| CLI | Elliott has a runtime CLI entry point | It has no `evolve`, `evaluate`, `compare`, `propose`, or promotion commands |
| Effect | Elliott uses Effect brands but learning workflows use mutable classes, Promises, and generic errors | New evolution workflows need Effect services, Layers, schemas, typed errors, cancellation, schedules, and observable operations |

The first phase will close only the gaps that block self-evolution. It will not turn adoption into a repository-wide rewrite.

## 5. Elliott-native architecture

### 5.1 Data flow

```text
Records + SessionStore + golden evals + benchmark failures
                         |
                         v
               SignalDetector and triage
                         |
                         v
       TargetAdapter resolves ref + active digest + baseline Snapshot
                         |
                         v
         DatasetBuilder creates an immutable, classified dataset
                         |
                         v
    OptimizationEngine runs in an isolated component or companion
                         |
                         v
          CandidateStore records content-addressed candidates
                         |
                         v
 Constraints -> task fitness -> independent comparison -> broad gates
                         |
                         v
             ProposalAuthor writes a Proposal directory
                         |
                         v
          HumanApprover -> ReleasePromoter -> candidate canary
                         |
                         v
    transactional activation -> new Snapshot -> epochs -> release Record
```

### 5.2 New schema-backed Protocols

Elliott should add behavior through Protocols rather than new Component kinds.

| Protocol | Core operations | Expected implementers |
| :--- | :--- | :--- |
| `evolution.target` | `inspect`, `materializeBaseline`, `applyCandidate`, `validateInvariant` | Target adapter Components or kernel-owned adapters |
| `evaluation.dataset` | `build`, `split`, `validateLeakage`, `describe` | Dataset builder evaluator Components |
| `optimization.engine` | `optimize`, `pause`, `resume`, `cancel`, `describeCapabilities` | GEPA, MIPROv2, and Darwinian evaluator Components |
| `evaluation.runner` | `evaluateCase`, `evaluateDataset`, `compare` | Elliott evaluation harness and specialized evaluators |
| `benchmark.runner` | `runSubset`, `runFull`, `compareBaseline` | Elliott check runner, TBLite, TerminalBench2, and YC-Bench adapters |
| `release.projection` | `render`, `publish` | Optional Git and pull-request projection Component |

Each operation needs an input schema, output schema, typed error schema, capability declaration, limit declaration, and audit event contract.

### 5.3 New domain records

Create schema-backed, immutable models for:

- `EvolutionRunId`, `CandidateId`, `DatasetId`, and `EvaluationReportId`.
- `EvolutionTarget`, including target class, Component ref, document or operation path, baseline digest, and risk class.
- `EvolutionRun`, including principal, Snapshot, engine, budgets, seeds, dataset digest, state, and timestamps.
- `DatasetManifest`, including source Records, classifications, license or consent metadata, split policy, case groups, and digests.
- `EvaluationCase`, including input, expected behavior or rubric, allowed effects, timeout, budget, and provenance.
- `Candidate`, including parent candidate, patch, materialized digest, engine trace, token and cost totals, and constraint results.
- `MetricDefinition`, `MetricResult`, `StatisticalComparison`, and `BenchmarkResult`.
- `EvolutionDecision`, a discriminated union for rejection, shortlist, Proposal authoring, staleness, promotion, and rollback.

Use `Schema.Class` for reusable records, `Schema.TaggedClass` for state variants, `Schema.TaggedErrorClass` for boundary failures, and branded schemas for identifiers and digests. Decode unknown IPC, YAML, JSONL, SQLite, and engine output at their boundaries.

### 5.4 Run state machine

The run state is separate from Proposal status:

```text
detected
  -> scoped
  -> dataset-ready
  -> optimizing
  -> shortlisted
  -> evaluated
  -> proposal-authored
  -> awaiting-review
  -> canary
  -> promoted
```

Terminal branches:

```text
rejected | stale | cancelled | budget-exhausted | failed | rolled-back
```

State transitions append Records. Transition functions must reject missing predecessors, stale target digests, budget overruns, and authority mismatches.

### 5.5 Effect service graph

Implement the new subsystem as focused Effect services:

- `EvolutionRunStore`
- `CandidateStore`
- `DatasetStore`
- `TargetRegistry`
- `EvolutionOrchestrator`
- `EvaluationHarness`
- `ConstraintEngine`
- `BenchmarkGate`
- `ProposalAuthorService`
- `ReleaseProjection`

Define live, test, and isolated-worker Layers. Compose each subsystem Layer near its module, then assemble one evolution Layer at the runtime boundary. Use `ManagedRuntime` only where the Elliott Promise-based host enters the Effect subsystem.

Use `Effect.fn` for run operations and spans. Preserve cancellation as interruption so an operator can stop an optimization run without converting the stop into a false evaluation failure. Use Effect `Schedule` for retry, polling, and recurring benchmark cadence. Do not hand-build sleep loops.

## 6. Authority, isolation, and information flow

### 6.1 Required principals

Use distinct principals for:

| Principal | Authority |
| :--- | :--- |
| `EvolutionSignalDetector` | Read eligible Records and append signals |
| `EvolutionProposalAuthor` | Read target and candidate storage; create a Proposal |
| `EvolutionOptimizer` | Read one materialized baseline and dataset subset; write one candidate namespace |
| `EvolutionEvaluator` | Read candidate Snapshots and hidden evaluation data; append evaluation results |
| `EvolutionHumanApprover` | Approve or reject a passing Proposal |
| `EvolutionReleasePromoter` | Promote an approved Proposal through transactional activation |
| `EvolutionGitProjector` | Create an optional branch or pull request after Proposal authoring |

The optimizer cannot act as evaluator, approver, or promoter. The Proposal author cannot approve or promote its change. A model route used to author candidates cannot judge the held-out comparison.

### 6.2 Capabilities

Introduce narrow resource forms rather than broad filesystem access:

- `evolution.target.read:<component-ref>@<digest>`
- `evolution.candidate.write:<run-id>`
- `evolution.dataset.read:<dataset-id>:train`
- `evolution.dataset.read:<dataset-id>:validation`
- `evolution.dataset.read:<dataset-id>:holdout`
- `evolution.engine.invoke:<engine-ref>`
- `evaluation.run:<snapshot-id>`
- `proposal.author:<target-ref>`
- `proposal.approve:<proposal-id>`
- `release.promote:<proposal-id>`
- `release.project.git:<repository-ref>`

The optimizer principal must not receive holdout access. The independent evaluator receives holdout access only after the optimizer seals its candidate set.

### 6.3 Isolation floors

- All optimizer and evaluator Components use `container` or `remote` isolation.
- GEPA and MIPROv2 share a Python companion only if their security contexts match.
- Darwinian Evolver receives its own container and candidate checkout.
- Code candidate execution uses an ephemeral container with no host mounts, no container-runtime socket, bounded CPU, memory, pids, time, tokens, and egress.
- Evaluation cases that need network access use declared hosts and broker inspection.
- `restricted` datasets use local-only model routes and local optimizer placement.

Security-critical `evaluator` Components remain org-pinned and cannot run below their ComponentSchema isolation floor.

### 6.4 Dataset classification

Every evaluation case inherits the maximum classification of its sources. A run frame rises as it reads cases. The route table must select engines and judges whose ResidencyGrants admit that classification.

Synthetic output derived from a confidential session remains confidential. Summaries, rubrics, traces, and candidate reflections keep the source classification unless a sanitizer pipeline produces an approved lower-classification derivative.

### 6.5 Secrets and untrusted content

Engine credentials remain secret references. Elliott mounts them only into the component that makes the request. Credentials never enter datasets, traces, prompts, Proposal artifacts, patches, logs, or Git projections.

Session content, external files, benchmark tasks, engine reflections, and candidate patches remain untrusted evidence. Candidate text never gains instruction precedence during evaluation.

### 6.6 Posture behavior

Every posture records target digests, dataset provenance, classifications, Grants, engine calls, candidate lineage, evaluation results, approvals, releases, and epoch changes.

- `standard` uses the single-level `internal` lattice and the configured approval workflow.
- `hardened` enforces confidential-data residency and any workspace review requirements.
- `regulated` uses the full lattice, local-only restricted routes, complete observational audit, and operator-visible approval queues.

A stricter posture may narrow engines, routes, targets, budgets, and automation. It cannot remove recorded provenance or grant an optimizer release authority.

## 7. Dataset and evaluation design

### 7.1 Dataset sources

Support the complete upstream set:

| Source | Elliott implementation | Initial use |
| :--- | :--- | :--- |
| Synthetic | A dataset builder evaluator reads the target and creates cases with a strong model | Bootstrap every target |
| Session-derived | Query `SessionStore` and Record projections for target use, outcomes, corrections, and failures | Add real usage after enough evidence exists |
| Golden | Versioned JSONL or YAML under a component's `evals/` directory | Security-sensitive and high-value targets |
| Target-specific executable | A deterministic evaluator checks a concrete outcome | Tools, code, search, file edits, and structured workflows |
| Benchmark-derived | Convert broad benchmark failures into task-specific cases without exposing broad holdouts to the optimizer | Hard-case growth |

Initial dataset sizes:

- Skill campaigns: 15 to 30 cases per target before session-derived growth.
- Tool campaigns: 10 to 20 positive cases per tool, 10 to 20 ambiguous pairs, and at least 10 no-tool cases. A normal catalog target will contain 200 to 400 cases.
- Prompt campaigns: 60 to 80 scenarios across identity, memory, recall, skill use, and presentation.
- Code campaigns: one or more defect reproductions plus generated edge cases for the named target.

### 7.2 Session schema extensions

Add durable tables or provider-neutral records for:

- `runs`: run ID, session, Snapshot, agent, disposition, start, and finish.
- `component_uses`: component ref, digest, operation, run, and outcome.
- `tool_calls`: requested tool, selected tool, schema digest, sanitized arguments digest, result digest, latency, and error tag.
- `feedback`: explicit correction, confirmed success, confirmed failure, and target attribution.
- `evaluation_labels`: evaluator ref, rubric digest, score, confidence, and source.
- `model_selections`: route and usage references needed for cost comparison.

Store argument or content bodies only when policy permits. Prefer Record references and digests in analytics tables.

### 7.3 Split and leakage policy

The dataset builder must:

1. Group cases by source session, repository fixture, issue, or benchmark task before splitting.
2. Keep related variants in one split.
3. Use a recorded seed and deterministic split algorithm.
4. Store train, validation, and holdout digests in the dataset manifest.
5. Hide holdout contents and case-level results from optimizer principals.
6. Reject duplicates and semantic near-duplicates across splits.
7. Freeze the holdout before the first candidate evaluation.
8. Prevent benchmark-derived cases from leaking the broad benchmark's private expected result.

Default split:

- 60 percent train.
- 20 percent validation.
- 20 percent holdout.

Small datasets may use repeated stratified cross-validation, but the independent final comparison still needs untouched cases.

### 7.4 Fitness

Each target declares a weighted metric set. Elliott will prefer deterministic metrics, then model judges.

Common dimensions:

- Task correctness.
- Procedure adherence.
- Tool or operation selection.
- Parameter correctness.
- Safety and policy compliance.
- Token footprint.
- Cost.
- Latency.

Judges return structured scores and evidence references. Free-form judge prose may help GEPA reflect, but it cannot replace the structured result.

### 7.5 Statistical comparison

For each baseline and candidate pair:

- Run paired cases with the same fixture, Snapshot inputs, route policy, and seed set.
- Record per-case deltas rather than comparing aggregate scores alone.
- Use bootstrap confidence intervals or a paired permutation test.
- Report effect size, confidence interval, sample count, failure count, and cost.
- Apply the phase's minimum improvement threshold.
- Reject a candidate when the confidence interval crosses the allowed regression floor.
- Correct for multiple comparisons when a run evaluates many final candidates.

The report must expose train, validation, and holdout results. Promotion depends on holdout and broad gates, not train score.

### 7.6 Evaluation ladder

Run cheaper gates first:

1. Target syntax and schema validation.
2. Target-specific immutable-field checks.
3. Permission delta and path containment.
4. Static security checks.
5. Focused unit and contract tests.
6. `bun run check` for every candidate that can enter the valid candidate set.
7. TBLite fast subset for every valid candidate.
8. Small task-specific evaluation subset.
9. Full task-specific validation set.
10. Independent holdout comparison.
11. Full TBLite for shortlisted candidates.
12. YC-Bench for prompt and final release candidates.
13. TerminalBench2 for final code candidates.
14. Canary execution.

Stages that do not apply to a target must produce a signed `not-applicable` result with a reason. They must not disappear from the report.

A candidate that fails `bun run check` cannot contribute positive fitness, join the shortlist, or reach holdout evaluation.

## 8. Target adapters

### 8.1 Skill instruction adapter

Scope:

- Standard `SKILL.md` files discovered through Elliott's Agent Skills loader.
- The instruction body and selected non-authority descriptive fields.

Frozen:

- Component ref and kind.
- `manifest.yaml`.
- Capability overlay.
- `allowed-tools`.
- Frontmatter fields that affect discovery or authority.
- External references and assets unless the campaign names them.

Constraints:

- Parse baseline and candidate with `loadAgentSkill`.
- Preserve the target procedure and declared purpose.
- Enforce component-specific prompt footprint budgets.
- Run injection-resistance cases because skill text enters prompt context.
- Activate the winner through a new component digest and Snapshot.

Initial targets should use deterministic success measures. Recommended first targets are a code-review skill, a search or research skill, and a debugging procedure once Elliott or a consumer agent installs them.

Phase gate:

- At least one skill improves its primary holdout score by 10 percent or the metric-specific equivalent.
- The confidence interval stays above the regression floor.
- `bun run check` passes and TBLite stays within two percent of baseline.
- Footprint gates pass.
- A human reviewer approves the semantic diff.

### 8.2 Tool-description adapter

Scope:

- Component card descriptions.
- Operation descriptions.
- Parameter descriptions.
- Model-facing behavioral guidance in `TOOL.md` where the schema binds it to the operation.

Frozen:

- Tool and operation names.
- Parameter names, types, required flags, enums, and schemas.
- Component refs, capabilities, egress, isolation, limits, output trust, and implementation exports.

Evaluation:

- Build triples of task, expected component operation, and expected parameter constraints.
- Include ambiguous tool pairs and no-tool cases.
- Evaluate the whole active tool catalog for each candidate set.
- Track per-tool precision, recall, confusion pairs, parameter correctness, no-tool accuracy, schema tokens, cost, and latency.
- Reject a catalog candidate when any active tool shows a statistically supported selection regression.

Size limits:

- Default top-level description limit: 500 characters.
- Default parameter description limit: 200 characters.
- Component policy may set lower limits.
- Elliott's measured tool-schema footprint remains the controlling budget.

Phase gate:

- Global holdout selection accuracy improves by at least 5 percent.
- No active tool shows a statistically supported selection regression.
- Descriptions remain accurate against operation schemas and implementation contracts.
- Footprint and full checks pass, TBLite stays within two percent of baseline, and canary passes.

### 8.3 Prompt-segment adapter

Elliott will evolve typed sources, not slices of a concatenated prompt.

Allowed initial targets:

- InteractionProfile presentation text.
- Agent identity text with zero authority.
- Memory-use guidance.
- Session-recall guidance.
- Skill-selection guidance.
- Gateway-specific presentation guidance.

Forbidden targets:

- Security policy and grant logic.
- Runtime-generated identity and Snapshot metadata.
- Secrets.
- User memory content.
- Retrieved evidence.
- The current task.
- Dynamic capability cards.
- Any text whose mutation could grant authority.

The adapter will map each upstream Hermes prompt section to a typed Elliott source:

| Hermes section | Elliott target |
| :--- | :--- |
| Agent identity | InteractionProfile or zero-authority Agent prompt source |
| Memory guidance | Governed workspace or Agent prompt source |
| Session search guidance | Governed skill-selection prompt source |
| Skills guidance | Governed skill-selection prompt source |
| Platform hints | Gateway delivery or InteractionProfile source |

Constraints:

- Preserve semantic purpose and PromptSegment trust.
- Keep stable-prefix bytes bound to the candidate Snapshot.
- Cap each segment at 120 percent of its baseline tokens unless a stricter budget applies.
- Evaluate sections alone, then evaluate the full prompt assembly.
- Reject authority claims, secret-handling drift, trust-order drift, and cache-boundary movement.

Phase gate:

- Targeted behavioral score improves by at least 10 percent.
- Broad benchmark regression tolerance is zero.
- Prompt footprint stays within budget.
- Style and identity judges use an independent route.
- The new prompt appears only in new Snapshots and sessions.

### 8.4 Code adapter

Start with isolated component implementation code. Expand by risk class after the lower class proves safe.

| Risk class | Target | Automation |
| :--- | :--- | :--- |
| C1 | Pure helper inside a bundled tool with deterministic tests | Scheduled campaigns allowed after Phase 5 |
| C2 | Tool or extension implementation inside one component package | Signal-triggered campaigns allowed |
| C3 | Gateway, model provider, evaluator, scheduler, or other security-critical Component | Operator starts each campaign; two reviewers |
| C4 | Kernel, broker, IFC, audit, placement, activation, hot core, schemas, or policy code | Operator-authored experiment only; no continuous scheduling |

Frozen by default:

- Component ref, kind, manifest, capability request, egress, isolation, companion images, Protocol IDs, exports, public signatures, and schema contracts.
- Error-handling and security-check call sites identified by static policy.
- Test fixtures and evaluator code.

Campaign-specific authorization may include a frozen field change, but that becomes a separate permission-delta Proposal and cannot share the automatic code-evolution path.

Fitness:

- Reproduce a known defect or deterministic edge case.
- Require the focused regression test to pass.
- Require all existing tests to pass.
- Compare task-specific behavior, benchmark scores, cost, and latency.
- Reject decreased error-path coverage, removed security checks, new ambient authority, new unbounded loops, new unsafe casts, or new network destinations.

Darwinian Evolver contract:

- Receive one materialized candidate checkout.
- Receive one target file set and test command allowlist.
- Return patches and engine metadata.
- Run without target-repository credentials.
- Use no Git remote.
- Store each mutation as candidate lineage, not as an active Git commit.

Phase gate:

- At least one known defect is fixed on holdout reproduction cases.
- `bun run check`, full TBLite, TerminalBench2, YC-Bench, security review, and canary pass.
- Every changed line receives human review.

## 9. End-to-end workflow

### Step 1: Detect and rank

`SignalDetector` consumes explicit feedback, deterministic failures, repeated workarounds, tool failures, and model reflections. The triage score combines:

```text
signal strength * usage frequency * expected impact * evaluator confidence
---------------------------------------------------------------------------
             estimated optimization and validation cost
```

Self-reflection can place a target in the queue. It cannot start a high-risk code campaign or support promotion by itself.

### Step 2: Scope the campaign

`TargetRegistry` resolves the target ref, target class, active digest, component policy, allowed mutation surface, risk class, and required gates. It captures the baseline Snapshot and fails on an uncommitted or unresolved target.

### Step 3: Build and seal data

`DatasetBuilder` gathers allowed sources, stamps classifications, groups related cases, splits data, scans for leakage, and writes an immutable dataset manifest. It grants train and validation subsets to the optimizer. It seals holdout access for the evaluator.

### Step 4: Establish a baseline

`EvaluationHarness` runs the baseline on validation and holdout data before optimization. The run stores case outcomes, trajectories, footprints, cost, latency, model routes, environment digests, and seeds.

### Step 5: Optimize

`EvolutionOrchestrator` calls the configured engine Component. The engine produces candidates within token, cost, time, count, and concurrency budgets. Candidate evaluation runs in clean frames and candidate Snapshots.

GEPA receives structured execution traces and failure evidence. MIPROv2 runs when GEPA fails, the target policy selects it, or an operator requests a comparison. Darwinian Evolver runs only for code campaigns.

### Step 6: Shortlist

`ConstraintEngine` rejects invalid candidates before expensive evaluation. The orchestrator keeps a Pareto set across quality, footprint, cost, and latency, then freezes a shortlist.

### Step 7: Evaluate independently

`EvolutionEvaluator` runs hidden holdout cases and required broad gates. It uses a route that excludes the candidate-authoring route. It writes a signed comparison report with per-case results and statistics.

### Step 8: Author a Proposal

`EvolutionProposalAuthor` selects a passing candidate and writes the Proposal directory. Proposal authoring rechecks the target digest. A changed target marks the run stale; Elliott never rebases an evolved patch without a new baseline and evaluation.

### Step 9: Review

Review surfaces show, in order:

1. Permission and authority delta.
2. Target and candidate digests.
3. Human-readable diff.
4. Holdout effect size and confidence.
5. Per-tool or per-category regressions.
6. Full-check and benchmark results.
7. Prompt, inference, and runtime footprint changes.
8. Optimization cost and rejected-constraint summary.
9. Engine, model route, dataset, and lineage provenance.

### Step 10: Promote and canary

`ReleasePromoter`:

1. Revalidates the target digest and approval signatures.
2. Reruns required deterministic checks.
3. Materializes an immutable candidate revision.
4. Updates the lockfile candidate.
5. Computes a candidate Snapshot.
6. Starts canary instances.
7. Runs canary health and behavior checks.
8. Writes rollback metadata.
9. Activates the candidate revision in one transaction.
10. Bumps affected epochs and writes a release Record.

### Step 11: Monitor and roll back

The monitor compares canary and post-release metrics with the stored baseline. A rollback activates the prior immutable revision through the same transaction. Elliott does not edit the new revision in place or depend on `git revert`.

Canary cohorts contain new sessions only. A deterministic assignment may run baseline and candidate cohorts in parallel, but Elliott will never change a session's Snapshot after the session starts.

## 10. Proposal and run storage

### 10.1 Platform state

Extend the TDD platform-state layout:

```text
~/.local/share/elliott/
├── evolution/
│   ├── runs/
│   ├── candidates/
│   ├── datasets/
│   └── reports/
├── proposals/
├── snapshots/
├── sessions/
└── records/
```

Reconstructable engine download caches, benchmark images, generated schema validators, and temporary candidate checkouts belong under `~/.cache/elliott/evolution/`.

### 10.2 Extended Proposal directory

```text
proposals/prp_01J.../
├── proposal.yaml
├── PROPOSAL.md
├── target.yaml
├── patch.diff
├── evidence.yaml
├── permission-diff.yaml
├── eval-plan.yaml
├── candidate.yaml
├── lineage.yaml
├── dataset.yaml
├── comparison.yaml
├── footprints.yaml
├── benchmarks.yaml
├── rollback.yaml
└── support/
    ├── rejected-constraints.yaml
    ├── case-summary.jsonl
    └── engine-summary.yaml
```

`proposal.yaml` will include the baseline target digest, candidate digest, baseline Snapshot, candidate Snapshot, Proposal author, run ID, target class, and risk class.

Large traces and private dataset contents stay in classified platform storage. Proposal artifacts reference their digests and Record IDs. Git projections must omit content that policy does not permit outside local storage.

Dataset and trace retention follows workspace privacy policy. Expiration may delete eligible physical payloads, but it retains the minimum immutable digest, release, approval, and audit Records required to explain an active or historical release.

## 11. Configuration and user surfaces

### 11.1 Configuration

Add `.elliott/evolution.yaml` for a consumer repository:

```yaml
apiVersion: elliott/v1
engines:
  text:
    primary: organization/evaluator/dspy-gepa
    fallback: organization/evaluator/dspy-mipro
  code:
    primary: organization/evaluator/darwinian

budgets:
  perRun:
    candidates: 40
    tokens: 2000000
    costUsd: 25
    durationMinutes: 180
  monthly:
    costUsd: 200

evaluation:
  authoringProfile: deep
  judgingProfile: deep
  requireDistinctRoute: true
  split: { train: 0.6, validation: 0.2, holdout: 0.2 }

continuous:
  enabled: false
  benchmarkCron: "0 3 * * 0"
  maximumRiskClass: C2
  maximumConcurrentRuns: 1

targets:
  allow:
    - "workspace/skill/*"
    - "core/tool/*"
  deny:
    - "core/policy/*"
    - "core/evaluator/*"
```

Changes to this file follow the Proposal and transactional activation path because it controls engines, costs, scheduling, and target scope.

### 11.2 CLI

Add commands with no direct deployment shortcut:

```text
elliott evolve inspect <target>
elliott evolve dataset build <target> [--source ...]
elliott evolve run <target> [--engine ...] [--budget ...]
elliott evolve status <run-id>
elliott evolve cancel <run-id>
elliott evolve compare <run-id> [--candidate ...]
elliott evolve propose <run-id> --candidate <id>
elliott proposal review <proposal-id>
elliott proposal approve <proposal-id>
elliott proposal reject <proposal-id>
elliott release promote <proposal-id>
elliott release rollback <release-id>
```

The CLI resolves the operator principal, Grants, and current Snapshot before each operation.

### 11.3 Agent operations

Expose compact model-facing operations:

- `evolution.inspect_target`
- `evolution.request_run`
- `evolution.get_status`
- `evolution.request_proposal`

The agent may request a run and author a Proposal when policy permits. It cannot call approval, promotion, or rollback operations. Those operations remain operator surfaces.

## 12. Implementation roadmap

### Phase 0: Close control-plane and component gaps

**Estimate:** 2 to 3 weeks

Deliverables:

1. Add Effect schemas and typed errors for evolution domain records.
2. Add the Protocol definitions from section 5.2.
3. Extend the bundled catalog loader and manifest validation to support `evaluator` and `EVALUATOR.md`.
4. Make Proposal state transitions durable and reloadable.
5. Add durable candidate Snapshot support.
6. Connect promotion to lockfile revision, Snapshot creation, activation hooks, epoch bumps, audit cross-links, canary start, and rollback metadata.
7. Add evolution Record types and durability classifications.
8. Add evolution config decoding and policy checks.
9. Build live and test Layers for the evolution subsystem.

Primary files:

- `src/learning/types.ts`
- `src/learning/proposals/index.ts`
- `src/learning/evaluation/index.ts`
- `src/config/activation/`
- `src/core/snapshot/`
- `src/core/protocol/`
- `src/catalog/bundled.ts`
- `schemas/elliott-component.json`
- `src/audit/`
- New `src/learning/evolution/`

Exit criteria:

- Elliott can persist, reload, evaluate, approve, promote, and roll back a hand-authored no-op candidate.
- A stale target digest stops promotion.
- Author, approver, and promoter separation survives restart.
- Activation produces one candidate Snapshot, one epoch transaction, and durable audit linkage.
- Existing G1 to G25 tests pass.

### Phase 1: Build the shared evaluation substrate

**Estimate:** 3 weeks

Deliverables:

1. Extend `SessionStore` and Record projections.
2. Implement DatasetManifest, builders, deterministic splitting, leakage checks, and classified storage.
3. Implement the Snapshot-bound `EvaluationHarness`.
4. Capture tool calls, component use, model selection, case disposition, footprints, cost, and latency.
5. Implement constraint, fitness, statistics, and comparison services.
6. Implement `bun run check` as a benchmark runner Component.
7. Implement TBLite, TerminalBench2, and YC-Bench adapters behind `benchmark.runner`.
8. Add run pause, resume, cancel, resource budgets, and candidate lineage.
9. Add CLI inspection, dataset, run, status, cancel, and compare commands.

Exit criteria:

- One fixed hand-written candidate runs through train, validation, hidden holdout, full checks, and a canary.
- Baseline and candidate runs reproduce from stored manifests and seeds.
- The optimizer principal cannot read holdout cases.
- A restricted dataset selects only admissible routes.
- Budget exhaustion and cancellation leave a resumable or terminal run without partial activation.

### Phase 2: Skill evolution with GEPA and MIPROv2

**Estimate:** 3 to 4 weeks

Deliverables:

1. Build the skill target adapter.
2. Build and pin the DSPy optimizer companion.
3. Implement GEPA and MIPROv2 operations.
4. Translate Elliott trajectories into the structured trace contract needed by GEPA.
5. Generate synthetic, golden, session-derived, and target-specific skill datasets.
6. Add skill constraints, semantic preservation, footprint penalties, and injection tests.
7. Add skill candidate rendering and Proposal artifacts.
8. Run campaigns on three installed skills with clear success measures.

Exit criteria:

- The GEPA engine can optimize any eligible discovered `SKILL.md`.
- MIPROv2 can run as a policy-selected fallback.
- At least one skill passes the phase gate in section 8.1.
- The promoted skill appears only in new Snapshots and sessions.
- The authority overlay and allowed-tool set remain byte-identical.

### Phase 3: Tool-description optimization

**Estimate:** 2 to 3 weeks

Deliverables:

1. Add digest-bound model-facing descriptions to the target catalog.
2. Build the tool-description target adapter.
3. Generate a cross-tool dataset with positive, ambiguous, parameter, and no-tool cases.
4. Add session mining for tool confusion and corrections.
5. Optimize descriptions as one catalog candidate set.
6. Add per-tool regression floors and schema footprint measurement.
7. Promote the winning catalog through a new Snapshot.

Exit criteria:

- The candidate improves global holdout tool-selection accuracy by at least 5 percent.
- Protected per-tool metrics pass.
- Names, schemas, capabilities, and implementation exports stay unchanged.
- Tool-schema footprint, full checks, TBLite, and canary pass.

### Phase 4: Typed prompt evolution

**Estimate:** 3 weeks

Deliverables:

1. Add stable IDs and target metadata to evolvable PromptSegment sources.
2. Build the prompt-segment target adapter and forbidden-purpose checks.
3. Create behavioral datasets for identity, memory, recall, skill selection, and gateway presentation.
4. Evaluate each segment alone and in the full prompt.
5. Add prompt cache identity, token budget, trust-order, and authority-drift checks.
6. Add independent style and identity evaluation.
7. Promote prompt candidates through InteractionProfile or governed prompt-source revisions.

Exit criteria:

- Targeted behavior improves by at least 10 percent.
- Broad benchmark regression tolerance remains zero.
- Cache identity changes only with the new Snapshot.
- Stable-prefix and segment footprint budgets pass.
- Prompt trust, security tags, and semantic order remain unchanged.

### Phase 5: Code evolution

**Estimate:** 4 weeks

Deliverables:

1. Build and pin the Darwinian Evolver container.
2. Implement the code target adapter, risk classes, frozen surfaces, and patch containment.
3. Add disposable candidate checkouts and test execution sandboxes.
4. Add known-defect reproduction and adversarial edge-case dataset builders.
5. Add static guards for signatures, manifests, capabilities, error handling, authority, and network changes.
6. Integrate full checks, TBLite, TerminalBench2, YC-Bench, and human line review.
7. Complete one C1 campaign, then one C2 campaign.
8. Validate the operator-only paths for C3 and C4 without enabling scheduled campaigns.

Exit criteria:

- At least one known defect passes its holdout reproduction.
- All deterministic, conformance, benchmark, security, canary, and review gates pass.
- Darwinian code remains outside the Elliott process and package.
- No optimizer container holds repository credentials or active-tree write access.

### Phase 6: Continuous self-improvement

**Estimate:** 2 to 3 weeks

Deliverables:

1. Build performance projections for skills, tools, prompt behaviors, benchmarks, cost, and corrections.
2. Implement the triage formula and target cooldowns.
3. Add recurring benchmark and optimization jobs to the Elliott scheduler.
4. Resolve authority at every scheduled fire.
5. Add run deduplication, concurrency limits, monthly budgets, and backoff.
6. Add notifications for detected regression, run completion, Proposal readiness, stale target, budget exhaustion, and rollback.
7. Enable unattended detection, dataset building, optimization, and Proposal authoring for allowed C1 and C2 targets.
8. Keep approval and promotion human-controlled.

Exit criteria:

- A scheduled benchmark runs in a fresh frame and records results.
- Triage selects the expected weak target from a seeded signal set.
- One cycle completes from signal through review-ready Proposal without operator work.
- Revoked scheduler authority blocks the next fire.
- Monthly and per-run budgets stop work before overspend.
- Human approval and release promotion remain mandatory.

## 13. Proposed file layout

```text
src/learning/
├── evolution/
│   ├── model.ts
│   ├── errors.ts
│   ├── protocols.ts
│   ├── services.ts
│   ├── layer.ts
│   ├── orchestrator.ts
│   ├── records.ts
│   ├── runs/
│   │   ├── store.ts
│   │   └── state.ts
│   ├── candidates/
│   │   ├── store.ts
│   │   └── lineage.ts
│   ├── datasets/
│   │   ├── model.ts
│   │   ├── builder.ts
│   │   ├── split.ts
│   │   ├── leakage.ts
│   │   └── sources/
│   ├── targets/
│   │   ├── skill.ts
│   │   ├── tool-description.ts
│   │   ├── prompt-segment.ts
│   │   └── code.ts
│   ├── evaluation/
│   │   ├── harness.ts
│   │   ├── trace.ts
│   │   ├── fitness.ts
│   │   ├── statistics.ts
│   │   └── comparison.ts
│   ├── constraints/
│   │   ├── common.ts
│   │   ├── skill.ts
│   │   ├── tool-description.ts
│   │   ├── prompt-segment.ts
│   │   └── code.ts
│   ├── benchmarks/
│   │   ├── elliott-check.ts
│   │   ├── tblite.ts
│   │   ├── terminalbench.ts
│   │   └── yc-bench.ts
│   └── release/
│       ├── proposal.ts
│       ├── promoter.ts
│       └── git-projection.ts
│
skills/
├── evaluator-dspy/
│   ├── manifest.yaml
│   ├── EVALUATOR.md
│   ├── schemas/
│   └── src/
├── evaluator-darwinian/
│   ├── manifest.yaml
│   ├── EVALUATOR.md
│   ├── schemas/
│   └── src/
└── evaluator-agent-benchmarks/
    ├── manifest.yaml
    ├── EVALUATOR.md
    ├── schemas/
    └── src/

test/
├── unit/evolution/
├── integration/evolution/
├── conformance/
└── fixtures/evolution/
```

Keep engine-specific wire clients inside their component packages. Keep target policy, Proposal authority, Snapshot creation, and promotion inside Elliott.

## 14. Adoption gates

These gates supplement G1 to G25. They do not weaken or replace a TDD gate.

**SE1, target binding:** Every run and Proposal binds to an active target digest. A target change makes the run stale before Proposal authoring or promotion.

**SE2, Snapshot isolation:** Every case runs against one immutable baseline or candidate Snapshot. Candidate content never appears in an unrelated active session.

**SE3, authority separation:** No principal can author and approve or author and promote the same Proposal. Optimizer and evaluator Grants do not overlap on candidate authoring and hidden holdout judgment.

**SE4, candidate containment:** An optimizer can write only to its run namespace. Attempts to write active source, config, lockfile, Proposal approval, Snapshot, or audit state fail.

**SE5, holdout secrecy:** Optimizer principals cannot read holdout cases, expected results, or case-level judge feedback before sealing the shortlist.

**SE6, reproducibility:** A stored baseline, candidate, dataset, environment, route policy, seed set, and evaluation plan reproduce the reported deterministic results. Stochastic reports include the recorded sample distribution.

**SE7, constraint completeness:** Every candidate has a result for every required constraint. Missing, malformed, timed-out, or crashed checks fail closed.

**SE8, statistical gate:** Promotion reports include paired effect size, confidence interval, sample count, regression floors, and multiple-comparison handling.

**SE9, footprint gate:** Skill, tool, and prompt candidates pass prompt footprint budgets. Every candidate passes configured inference and runtime footprint budgets.

**SE10, engine isolation:** Python engines and Darwinian Evolver run outside the kernel in digest-pinned isolated placements. Engine output crosses a validated schema boundary.

**SE11, durable promotion:** No active artifact changes before the promotion Record is durable. Activation creates rollback metadata, a Snapshot, affected epoch bumps, and an audit cross-link.

**SE12, no direct deployment:** Agent and optimizer operations can end at a review-ready Proposal. They cannot approve, promote, or merge authority into active state.

**SE13, code safety:** A code candidate cannot alter frozen manifests, Protocol schemas, public signatures, capabilities, egress, isolation, security checks, or evaluator fixtures without a separate operator-scoped Proposal.

**SE14, continuous-loop freshness:** Scheduled jobs resolve the current principal and capabilities at fire time, use fresh frames, deduplicate leases, and obey cost and concurrency budgets.

**SE15, rollback integrity:** Rollback activates an immutable prior revision through the promotion transaction. Historical candidate, Proposal, release, and evaluation Records remain unchanged.

## 15. Test strategy

### Unit tests

- Domain schema encode and decode round trips.
- State machine transition laws.
- Dataset grouping and split determinism.
- Leakage detection.
- Candidate lineage.
- Metric aggregation and statistics.
- Constraint behavior per target type.
- Budget accounting.
- Triage ranking.
- Typed error recovery and interruption.

### Property and fuzz tests

- Candidate patches cannot escape target paths.
- Mutation inputs cannot change frozen fields.
- Random dataset groups never cross splits.
- Random epoch or target changes cannot produce a stale promotion.
- Engine output decoding fails closed for malformed unions, oversized fields, and missing digests.
- Tool-description candidates preserve JSON Schema equivalence.
- Prompt candidates preserve purpose, trust, and security tags.

### Integration tests

- Fake optimizer Component through IPC.
- GEPA companion smoke test.
- MIPROv2 fallback test.
- Darwinian external CLI smoke test without network or Git credentials.
- Baseline and candidate Snapshot comparison.
- Proposal persistence across restart.
- Optional Git projection with a local bare remote.
- Canary failure and rollback.
- Restricted dataset route selection.
- Scheduler cancellation and authority revocation.

### Conformance and broad gates

Every promotion runs:

- Applicable SE gates.
- G1 to G25.
- `bun run check`.
- Target-specific evaluations.
- Configured broad benchmark adapters.
- Canary checks.

## 16. Audit and observability

### 16.1 Record taxonomy

Add Records for:

- `evolution.signal.detected`
- `evolution.run.scoped`
- `evolution.dataset.sealed`
- `evolution.baseline.completed`
- `evolution.engine.started`
- `evolution.candidate.created`
- `evolution.candidate.rejected`
- `evolution.shortlist.sealed`
- `evolution.evaluation.completed`
- `evolution.proposal.authored`
- `evolution.review.approved`
- `evolution.review.rejected`
- `evolution.canary.started`
- `evolution.canary.failed`
- `evolution.release.promoted`
- `evolution.release.rolled-back`
- `evolution.run.cancelled`
- `evolution.budget.exhausted`

Candidate creation and scoring are observational. Approval, Git publication, canary dispatch with external effects, promotion, epoch bump, and rollback require effect-gating durability where an irreversible effect depends on the Record.

### 16.2 Spans and metrics

Use named `Effect.fn` operations for:

- `scopeEvolutionRun`
- `buildEvolutionDataset`
- `evaluateEvolutionBaseline`
- `optimizeEvolutionTarget`
- `evaluateEvolutionCandidate`
- `authorEvolutionProposal`
- `promoteEvolutionProposal`
- `rollbackEvolutionRelease`

Annotate spans with IDs and digests, not prompt bodies, secrets, or private cases.

Metrics:

- Runs and candidates by target class and outcome.
- Candidate rejection reasons.
- Fitness delta and broad regression delta.
- Tokens, cached tokens, cost, latency, and engine time.
- Queue wait and active duration.
- Proposal approval rate.
- Canary rollback rate.
- Tool-confusion matrix.
- Dataset source and classification counts.
- Monthly budget consumption.

## 17. Cost and operational controls

Run budgets use Elliott's resource-limit algebra. The effective limit is the minimum across organization, workspace, agent, session, campaign, and invocation limits.

Controls:

- Stop candidate generation at the first exhausted budget.
- Keep train subsets small during search.
- Run deterministic constraints before model calls.
- Use validation subsets during optimization and hidden holdout only for frozen finalists.
- Run full broad benchmarks only for the top candidates.
- Cache evaluation results by candidate digest, dataset digest, evaluation-plan digest, Snapshot environment digest, model-route digest, and seed.
- Treat a cache miss or corrupt entry as recomputation.
- Never cache an approval or a result across an input digest change.

Initial default caps:

| Limit | Default |
| :--- | :--- |
| Candidates per text run | 40 |
| Candidates per code run | 20 |
| Concurrent optimization runs | 1 |
| Concurrent case evaluations | 8 |
| Text run cost | 25 USD |
| Code run cost | 50 USD |
| Text run wall time | 3 hours |
| Code run wall time | 6 hours |

Operators can change caps through Proposal-governed configuration.

## 18. Risks and mitigations

| Risk | Mitigation |
| :--- | :--- |
| Optimizer overfits synthetic cases | Grouped hidden holdout, session-derived cases, deterministic anchors, and broad gates |
| Model judge favors its own writing | Exclude the authoring route and compare deterministic metrics first |
| Tool descriptions steal calls from peers | Optimize and evaluate the full catalog; enforce per-tool floors |
| Prompt changes alter authority or cache structure | Typed target allowlist, frozen trust metadata, permission delta, and Snapshot-only activation |
| Candidate code weakens security | Risk classes, frozen surfaces, static policy, full G1 to G25, sandboxing, and line review |
| Session data leaks to an external optimizer | IFC classification, ResidencyGrant filtering, local routes for restricted data, and classified storage |
| Holdout leaks through traces | Separate Grants and principals; seal shortlist before evaluator access |
| Run cost grows without bound | Resource limits, staged evaluation, cancellation, monthly caps, and scheduler deduplication |
| An engine compromise writes active code | Candidate-only capability, disposable checkout, no repo credential, and no active mount |
| Proposal becomes stale during a long run | Digest checks at scoping, Proposal authoring, approval, and promotion |
| Git state diverges from Elliott state | Treat Git as a projection; activate only from Proposal and release digests |
| AGPL obligations spread into Elliott | External CLI boundary, separate image, no import or link, and license review |
| Continuous automation creates noisy Proposals | Frequency and impact triage, target cooldowns, deduplication, and minimum evidence |

## 19. Definition of full adoption

Elliott completes this plan when:

1. GEPA, MIPROv2, and Darwinian Evolver work through isolated, schema-backed Components.
2. Skill, tool-description, typed-prompt, and code target adapters can produce review-ready Proposals.
3. Synthetic, session-derived, golden, benchmark-derived, and target-specific datasets work.
4. Hidden holdout evaluation, statistical comparison, task fitness, full Elliott checks, broad benchmarks, footprint gates, and canaries protect promotion.
5. Proposal authoring, human approval, release promotion, Snapshot activation, epoch bumps, audit ordering, and rollback form one tested workflow.
6. The scheduler can detect a weak target, optimize it, and produce a Proposal without operator work.
7. The scheduler cannot approve or promote that Proposal.
8. G1 to G25 and SE1 to SE15 pass in CI.
9. One production skill release, one tool-description release, one prompt release, and one isolated component code release complete the workflow and retain reproducible lineage.

## 20. Critical path and schedule

| Phase | Estimate | Depends on |
| :--- | :--- | :--- |
| 0. Control-plane closure | 2 to 3 weeks | Current Elliott control plane |
| 1. Evaluation substrate | 3 weeks | Phase 0 |
| 2. Skill evolution | 3 to 4 weeks | Phase 1 |
| 3. Tool descriptions | 2 to 3 weeks | Phase 2 engine and evaluation work |
| 4. Typed prompts | 3 weeks | Phases 2 and 3 broad gates |
| 5. Code evolution | 4 weeks | Mature evaluation and sandbox path |
| 6. Continuous loop | 2 to 3 weeks | Phases 2 through 5 |

Expected total: 19 to 23 weeks for one experienced implementation team, plus benchmark runtime and human review. Phase gates control progression. A failed gate extends its phase; it does not lower the threshold or bypass the remaining work.
