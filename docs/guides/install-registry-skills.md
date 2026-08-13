# How to install skills from the registry

Beyond the bundled packages, you can install skills from a registry repository
with per-skill semver tags. The default registry is `github.com/nficano/skills`;
any repository with the same layout works.

Design and internals: [The skills registry](../explanation/skills-registry.md).

## Declare what you want

Add an `install:` block to the `config/elliott.yaml` in the tree the runtime
boots from:

```yaml
install:
  registry: owner/skills-repo
  refresh: false
  skills:
    - hello-web              # unpinned, resolves to semver-max at install time
    - hello-web@1.2.0        # pinned to exactly this tag
```

With no `install:` block, the feature is inert and you run bundled skills only.

Entries are `name` or `name@version`. Anything that does not match is a fatal
config error, as are duplicates and any name colliding with a bundled or
agent-local skill. An unknown name with no lock entry is also fatal, because a
grammar-valid typo could never have been a working config.

## Install and lock

```bash
bunx elliott skills install            # materialize from the committed lock
bunx elliott skills install --refresh  # re-resolve unpinned entries, rewrite lock
bunx elliott skills lock               # same as install --refresh
```

`install` without `--refresh` is the frozen path: it reads `skills.lock.json`,
fetches exactly the locked tags, verifies each against its locked digest, and
fails the build on a mismatch or an unreachable registry. Run it in your
Dockerfile.

`--refresh` re-resolves unpinned entries against live tags and rewrites the
lock. Run it in a CI bump job or by hand. Never boot a runtime and copy the lock
back out.

## Commit the lock

`skills.lock.json` lives in your agent repository and is authoritative:

```json
{
  "version": 1,
  "registry": "owner/skills-repo",
  "skills": {
    "hello-web": {
      "version": "1.2.0",
      "tag": "hello-web/v1.2.0",
      "digest": "sha256-…",
      "pinned": false
    }
  }
}
```

Two containers built from the same commit get byte-identical skills no matter
what tags landed upstream since. Production never refreshes, so a pushed
`hello-web/v99.0.0` cannot become law on the next restart.

## If the registry is unreachable at boot

Entries with a lock line and an intact cache load from cache. Entries with
neither are skipped and reported, and boot proceeds degraded.

A degraded boot must not claim to be healthy, so mark anything you cannot run
without as required (gateways default to required) and watch `ready` in
`/healthz`. The `install` section there reports per-skill state as `ok`,
`cached-fallback`, or `failed`.

## Verify

```bash
curl -s localhost:8080/v1/components
```

Installed skills appear alongside bundled ones. One whose secrets or allowlists
are missing stays dormant rather than failing the boot, the same as any bundled
skill. See [Activation gates](../reference/activation-gates.md).
