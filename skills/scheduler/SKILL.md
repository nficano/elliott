---
name: scheduler
description: Run due work in fresh frames under a lease, re-resolving authority at fire time. Use when scheduling reminders or deferred jobs.
---

# Scheduler

Run due work in fresh frames under a lease. Jobs store a principal and requested
capabilities—not resolved grants—and authority is resolved again at fire time.
