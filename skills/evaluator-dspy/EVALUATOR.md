# DSPy text optimizer

Isolated companion adapter for GEPA and MIPROv2. Elliott supplies a sealed
training/validation view, a materialized text target, limits, and a seed. The
companion returns schema-validated candidate lineage only. It cannot access
holdout data, Proposals, active configuration, Snapshots, Git credentials, or
release operations.

GEPA is the primary reflective optimizer. MIPROv2 is the policy-selected
fallback. Model calls are made through Elliott-authorized routes rather than
ambient companion credentials.

The image validates the train/validation-only wire view, enforces run budgets,
and uses a loopback model proxy with a short-lived scoped token. Optimization
jobs are real process groups with bounded time slices, pause, resume, and
idempotent cancellation. Fixture mode is limited to build and protocol smoke
tests.
