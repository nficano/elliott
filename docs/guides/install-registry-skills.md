# How to install skills from the registry

Beyond the bundled packages in `skills/`, Elliott can install additional
skills from the public `nficano/skills` registry at build/CLI time. Design
and internals: [Skills registry](../explanation/skills-registry.md).

## Declare the skills you want

Add an `install:` block to your runtime configuration (`config/elliott.yaml`
in the tree the runtime boots from). With no `install:` block configured,
the runtime runs bundled skills only.

## Install and lock

```bash
bunx elliott skills install            # fetch, verify digests, materialize
bunx elliott skills lock               # write the digest lock
bunx elliott skills install --refresh  # re-resolve instead of using the lock
```

Installation is deliberately **not** a runtime step: it happens at build or
CLI time, producing content whose digests are pinned in the lock file. A
digest mismatch at install time fails closed.

## Verify what registered

Boot and check the loaded package list — installed skills appear alongside
bundled ones, and a skill whose secrets or allowlists are missing stays
unregistered rather than failing the boot (see
[activation status](../reference/blockers.md) for the bundled examples of
this behavior).
