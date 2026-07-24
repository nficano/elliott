---
name: code-review
description: Review a focused code change for correctness and regressions.
allowed-tools: []
---

# Code review

Read the change in its surrounding module and identify concrete correctness,
compatibility, and maintainability risks. Trace important inputs through the
changed behavior, check the relevant tests, and distinguish blocking defects
from optional improvements.

Lead with findings ordered by severity. Cite the affected file and location,
explain the failure mode, and avoid speculative warnings that are not grounded
in the code. If no actionable defect is found, say so and name any remaining
test or coverage uncertainty.
