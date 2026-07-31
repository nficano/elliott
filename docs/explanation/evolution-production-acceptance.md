# Elliott evolution production acceptance

This is the deployment acceptance contract for
[governed self-evolution](design-decisions.md#learning-produces-proposals-not-mutations):
what a deployment must prove before claiming the workflow is adopted in
production. Local fixtures are not production evidence. A deployment must
collect an `EvolutionProductionAcceptanceManifest` from its registry,
scanners, legal review, executor deployment, route policy, CI, scheduler,
human reviews, and four completed release campaigns.

Run the fail-closed auditor with:

```text
bun run evolution:acceptance -- \
  /path/to/production-acceptance.json \
  /path/to/.elliott-runtime
```

The command decodes the schema-v2 manifest through the Effect schema, loads
the durable Elliott evolution, Proposal, and Snapshot stores from the supplied
runtime-state root, prints a structured report, and exits unsuccessfully when
any requirement is absent or inconsistent.

## Required evidence groups

| Group | Required proof |
| :--- | :--- |
| Companion deployments | Separate GEPA, MIPROv2, and Darwinian execution evidence; digest-bound registry image references; platform, publication, vulnerability-scan, isolation, and deployment attestations |
| External executors | Candidate-check, evaluation-case, broad-benchmark, and canary deployments behind bearer-authenticated loopback boundaries with immutable Snapshot resolution |
| Route policy | Distinct, authorized authoring and independent evaluation route digests |
| Darwinian distribution | AGPL-3.0 organizational approval, corresponding-source digest, and notices digest |
| CI | Commit and result digests plus passing repository, G1–G25, and SE1–SE15 gates |
| Continuous loop | One observed unattended scheduler run ending in a Proposal, with approval and promotion authority explicitly absent |
| Code campaigns | Passing C1 and C2 campaign evidence, including known-defect holdout results |
| Production releases | Exactly one Skill, tool-description catalog, prompt-segment, and isolated code release with review, stage-gate, full-check, canary, immutable rollback, deployment, and retained-lineage evidence |
| Durable lineage | The active, canary, and rollback releases; terminal run; sealed dataset; materialized candidate; independent evaluation report; approved Proposal; and baseline, evaluation, release, and rollback Snapshots for every release |

Every evidence digest in the manifest must be a complete lowercase SHA-256
digest. The image reference must end in its declared digest. Each production
release must match Elliott's durable state across:

- active and canary release identity and bindings;
- immutable rollback release, rollback audit cross-link, and rolled-back run
  terminal state;
- run, target, baseline, dataset, and optimization-seed bindings;
- candidate materialized bytes, recomputed digest, and passing constraints;
- approved Proposal evolution metadata and required separated reviewers;
- sealed dataset identity, recomputed split and manifest integrity, leakage
  checks, and holdout sealing;
- independent evaluation routes, holdout statistics, applicable benchmark
  gates, and prompt, inference, and runtime footprints;
- baseline, evaluation, release, and rollback Snapshot ancestry and active
  target configuration; and
- a recomputed canonical lineage digest covering all of those durable
  artifacts.

Removing or altering any referenced artifact makes the audit fail. The
Proposal directory itself is excluded from the lineage digest because its
approval records are mutable during review; its immutable evidence fields,
support artifacts, evolution metadata, status, and approver identities are
included in canonical sorted form.

## The SE gates

The self-evolution invariants supplement the TDD's G1–G26 and never weaken
them. They are enforced by `test/conformance/se-evolution*.test.ts` and
re-checked as CI evidence by this auditor:

| Gate | Invariant |
| :--- | :--- |
| SE1, target binding | Every run and Proposal binds to an active target digest; a target change makes the run stale before authoring or promotion |
| SE2, Snapshot isolation | Every case runs against one immutable baseline or candidate Snapshot; candidate content never appears in an unrelated active session |
| SE3, authority separation | No principal authors and approves, or authors and promotes, the same Proposal; optimizer and evaluator Grants do not overlap on candidate authoring and hidden holdout judgment |
| SE4, candidate containment | An optimizer writes only to its run namespace; writes to active source, config, lockfile, approval, Snapshot, or audit state fail |
| SE5, holdout secrecy | Optimizer principals cannot read holdout cases, expected results, or case-level judge feedback before the shortlist is sealed |
| SE6, reproducibility | Stored baseline, candidate, dataset, environment, route policy, seeds, and evaluation plan reproduce the reported results |
| SE7, constraint completeness | Every candidate has a result for every required constraint; missing, malformed, timed-out, or crashed checks fail closed |
| SE8, statistical gate | Promotion reports include paired effect size, confidence interval, sample count, regression floors, and multiple-comparison handling |
| SE9, footprint gate | Candidates pass prompt, inference, and runtime footprint budgets |
| SE10, engine isolation | Foreign-runtime engines run outside the kernel in digest-pinned isolated placements; engine output crosses a validated schema boundary |
| SE11, durable promotion | No active artifact changes before the promotion Record is durable; activation creates rollback metadata, a Snapshot, epoch bumps, and an audit cross-link |
| SE12, no direct deployment | Agent and optimizer operations end at a review-ready Proposal; they cannot approve, promote, or merge authority into active state |
| SE13, code safety | A code candidate cannot alter frozen manifests, schemas, signatures, capabilities, security checks, or evaluator fixtures without a separate operator-scoped Proposal |
| SE14, continuous-loop freshness | Scheduled jobs resolve principal and capabilities at fire time, use fresh frames, deduplicate leases, and obey cost and concurrency budgets |
| SE15, rollback integrity | Rollback activates an immutable prior revision through the promotion transaction; historical Records remain unchanged |

## Stage thresholds

The auditor also enforces the initial stage thresholds:

- Skill primary improvement of at least 10%, with broad regression no greater
  than 2%.
- Tool-selection improvement of at least 5%, protected metrics passing, and
  broad regression no greater than 2%.
- Prompt targeted improvement of at least 10%, zero broad regression, and
  independent style/identity evidence.
- Code known-defect holdout success, frozen surfaces, full checks, human
  review, and canary success.

The schema and auditor are implemented in
`src/learning/evolution/model/acceptance.ts` and
`src/learning/evolution/acceptance/`. They validate the completeness and
internal consistency of supplied evidence. The epoch transaction, rollback
epoch transaction, review-record, stage-gate, deployment, and rollback-drill
digests remain external attestations because the current runtime stores their
cross-links rather than the originating systems' records.

The auditor does not invent registry publication, scanner output, legal
approval, route authorization, human decisions, or production results. Those
records must come from the systems that performed the work. A passing local
fixture proves the acceptance logic, not production adoption.
