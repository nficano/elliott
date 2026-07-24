---
name: debugging
description: Diagnose a reproducible failure and isolate its root cause.
allowed-tools: []
---

# Debugging

Begin with the observed failure, the expected behavior, and the narrowest
reproduction available. Collect concrete evidence at the boundary where the
two diverge, then trace inputs and state backward until one explanation
accounts for every relevant observation.

Change one variable at a time. Use focused assertions or instrumentation to
discriminate between hypotheses, and check recent changes only as evidence,
not as proof of causation. Preserve unrelated behavior and avoid broad fixes
until the failing invariant is understood.

Report the root cause, the evidence that rules out competing explanations,
and the smallest safe correction. Name any untested edge, environment
assumption, or follow-up verification still required.
