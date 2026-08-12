# Installation

Elliott is distributed as a package that your own agent repository installs
and composes. It is not a hosted service and has no standalone installer.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1 — runtime, package manager, and test runner
- Git

## As a dependency of your agent repository

Add Elliott as a git dependency and import from its package exports:

```bash
bun add "elliott@git+ssh://git@github.com/nficano/elliott.git"
```

```typescript
import { AgentKernel } from "elliott";
import { defineComponent } from "elliott/core";
```

The full export map (`elliott/core`, `elliott/security`, `elliott/skills`,
`elliott/runtime`, …) is listed in
[reference/api/package-exports.md](../reference/api/package-exports.md).

If you do not have an agent repository yet, scaffold one — see
[Create an agent repository](../guides/create-an-agent-repo.md).

## Working on Elliott itself

```bash
git clone git@github.com:nficano/elliott.git
cd elliott
bun install
```

`bun install` also installs the repository's git hooks via the `prepare`
lifecycle — this is intentional; the hooks enforce the quality gates
described in [contributing/quality-gates.md](../contributing/quality-gates.md).

Verify the toolchain:

```bash
bun test           # unit + integration + conformance suites
bun run typecheck  # tsc --noEmit
```

## Next

Continue to the [Quickstart](quickstart.md).
