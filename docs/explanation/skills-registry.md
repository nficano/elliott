# Installable skills: the registry

Elliott loads skill packages from three sources: the framework's bundled
`skills/`, the agent repo's `agents/<name>/skills/`, and **installed skills**
resolved from a public registry repo with per-skill semver tags. All three use
one package contract: `manifest.yaml` + `SKILL.md` + `src/` with
`register(context)`. There is no second contract for installed skills; they get
the same loader, the same facility system, the same governance (ToolGovernor
wraps their tools identically), and the same appearance in
`SkillContext.packages()` and on the deep-trace map.

The default registry is `github.com/nficano/skills`. Any repo with the same
layout works. The examples below use a toy skill, `hello-web`.

## Registry layout and tagging

A registry is a monorepo where each top-level directory is one skill:

```
<owner>/<registry>
├── README.md
├── .github/workflows/ci.yml   # validation, see CI below
└── hello-web/
    ├── manifest.yaml           # metadata.name MUST equal the directory name
    ├── SKILL.md
    └── src/…                   # imports only elliott/* + builtins + own ./relatives
```

Rules:

- **No `package.json` inside a skill directory.** A nested `package.json`
  shadows elliott's package self-reference and breaks `import "elliott/skills"`
  in dev mode; CI and the installer both reject it.
- **No npm dependencies.** A skill's `src/**` imports only `elliott/*` subpath
  exports, Node/Bun builtins, and its own `./` relatives. Cross-package
  imports (`../<other-skill>`) are rejected.
- **Versioning is per-skill git tags** `<name>/v<major>.<minor>.<patch>`, e.g.
  `hello-web/v1.2.0`. At the tagged commit the skill's `metadata.version` must
  equal the tag version (CI-enforced at tag push; the installer re-verifies).
- **"Latest" = semver-max**, not chronologically newest: the highest
  `major.minor.patch` among tags matching `<name>/v*` that parse as exactly
  three integers. Prerelease and build suffixes are excluded.

## Config surface

An `install:` block in the agent repo's `config/elliott.yaml`, parsed by
`loadRuntimeSettings` into `RuntimeSettings.install`:

```yaml
install:
  registry: owner/skills-repo     # on github.com
  refresh: false                  # default; true only where state is writable (dev)
  skills:
    - hello-web                   # unpinned → resolves to latest at install time
    - hello-web@1.2.0             # pinned → exactly this tag
```

- Entry grammar: `name` or `name@version`; `name` matches `[a-z][a-z0-9-]*`,
  `version` matches `\d+\.\d+\.\d+`. Anything else is a **fatal** config error.
- Duplicate names: fatal.
- A name colliding with a bundled or agent-local skill: fatal at merge time.
- **An unknown skill name with no lock entry is fatal**, not a silent skip. A
  grammar-valid typo could never have been a working config, so it fails loud.
- `refresh: true` opts a *writable* environment into boot-time latest
  re-resolution. Production leaves it `false`; the baked lock is law.
- Absent `install:` block: the feature is inert.

## Installation and version resolution

One code path, the **installer**, exposed as
`elliott skills install [--frozen] [--refresh]`, invoked in two places:

1. **Image build (authoritative, network available).** The agent repo's
   Dockerfile runs `elliott skills install --frozen`. `--frozen` reads the
   committed `skills.lock.json`, fetches exactly the locked tags, verifies each
   against its locked digest, and materializes the cache into an image layer.
   No "latest" resolution happens here. The build fails loudly if the registry
   is unreachable or a digest mismatches, which is the correct place to fail.
2. **Boot (optional refresh, writable state only).** With `refresh: true`, the
   runtime runs the installer between `loadRuntimeSettings` and package
   discovery, re-resolving unpinned entries against live tags and rewriting
   the lock. In a read-only production container this step is a no-op read of
   the baked cache.

"Latest" resolves when you build or refresh; that resolution freezes into the
committed lock that ships to production. Production boots are deterministic
and offline-safe: a booted container never depends on the registry host.

### Frozen install mechanics

For each locked entry `{name, version, tag, digest}`:

1. Group entries by the commit their tag points to and fetch each unique
   commit's tarball once; a bulk tag drop shares one download.
2. Stream the codeload tarball to a temp file with hard byte caps on both the
   compressed download and the decompressed output.
3. Extract with the **system `tar`** (GitHub tarballs are pax format, which a
   hand-rolled ustar parser mis-reads), then whitelist only the skill subtree:
   regular files and directories, rejecting any entry that escapes it.
4. Copy `<name>/**` into `cache/<name>/<version>/` via temp-dir + atomic
   rename on the same filesystem.
5. Validate: manifest parses; `apiVersion: elliott/v1`; `metadata.name ==
   name`; `metadata.version == version`; entrypoint exists; no nested
   `package.json`; no `../<sibling>` imports. Any failure rejects the skill
   (cache nothing) and is fatal under `--frozen`.
6. Compute the **all-files digest**: sha256 over every extracted file's
   relative path + bytes, sorted. It must equal the locked digest or the
   install fails. This is what makes the committed lock a real pin.

### Refresh

Trust-on-first-use with an authoritative lock:

1. One tag listing for the whole registry
   (`GET /repos/…/git/matching-refs/tags/`, a single unpaginated response). If
   `secrets.github_token` resolved, send it as bearer.
2. Pinned entries resolve to the pin, cross-checked against a direct ref
   lookup. Unpinned entries resolve to semver-max.
3. **Unpinned float is gated, not automatic.** A tag higher than the locked
   version is a candidate: the installer fetches, validates, updates the lock,
   and logs the change **only during an explicit refresh run**. Production
   never refreshes, so a single pushed `hello-web/v99.0.0` cannot silently
   become law on the next restart. First install of a brand-new entry fetches
   latest and records it, the one unavoidable TOFU moment.
4. Fetch/extract/validate/digest exactly as under `--frozen`; write the
   updated lock atomically.

### Degraded boot

When the refresh path cannot reach the registry: every entry with a lock line
and intact cache loads from cache; entries with no lock or cache are skipped
and reported; boot proceeds degraded, consistent with "a failed `register()`
never kills boot". A degraded boot must not report itself healthy, so:

- Install entries carry a `required` marker (gateways default to required).
- `/healthz` gains an `install` section:
  `{skill, requested, resolved, state: ok|cached-fallback|failed, error?}`.
- `health.ready` is **false** if any `required` entry is not `ok`.

Config errors (bad grammar, duplicates, collisions, unknown-name-with-no-lock)
are fatal. Environmental errors (registry down, a missing non-required cached
skill) degrade.

## Cache and lockfile

- **Cache:** `<agentRoot>/.elliott/skills/<name>/<version>/…`, gitignored,
  populated at image build and mounted read-only at runtime. The package
  discoverer is never pointed at the cache root (it would recurse into every
  retained version and crash on duplicate names); the installer hands the
  loader each exact `<name>/<version>` directory.
- **Lockfile:** `<agentRoot>/skills.lock.json`, committed in the agent repo:

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

- The committed lock is authoritative. `--frozen` verifies fetched bytes
  against `digest`; a mismatch fails the build. Two containers built from the
  same commit get byte-identical skills regardless of what tags landed
  upstream since.
- The in-container lock is never authoritative and, in production, never
  written. Only `--refresh` (dev, or a CI bump job) rewrites the committed
  lock. Entries for skills no longer in config are pruned on the next refresh.
- Changing the `registry` field is advisory: it does not invalidate existing
  digests (that would be a downgrade lever); a registry change is a loud,
  operator-confirmed refresh.
- `elliott skills lock` resolves all unpinned entries to current semver-max,
  fetches + digests, and writes the committed lock. Run it in a CI bump job or
  by hand; never boot a runtime and copy the file out.

## How installed skills read config

`register()` is arbitrary code that runs before ToolGovernor wraps anything,
so the `SkillContext` it receives is scoped:

- **Control-plane secrets never appear on any `SkillContext`.** Skill code
  cannot read the governance kill-switch bearer token.
- Installed skills receive a scoped settings view: their own config block plus
  only the `secret://` grants their manifest declares, not the global secret
  bag.

## Testing and registry CI

Elliott-side (hermetic, no network): unit coverage for the entry grammar,
semver-max selection, the digest recipe, lock read/write/prune, frozen vs
refresh, the gated-float rule, and tar extraction against a golden codeload
pax tarball including hostile entries (`../` escape, absolute path, symlink,
nested `package.json`, sibling import) all rejected. Integration tests run the
installer against a local fixture registry (a Bun server serving canned refs
JSON + real `tar.gz` blobs), then boot a runtime that includes the fixture
skill and assert its tool registers and executes, plus the failure paths:
collision fatal, unknown-name-no-lock fatal, degraded-but-not-required
`ready:true`, missing-required `ready:false`.

Registry-side CI, on every push/PR: manifest schema validation, directory-name
== `metadata.name`, the import allowlist, no nested `package.json`, typecheck
and a `register()` contract smoke against a pinned elliott. On tag push
`<name>/v*`: assert the tag version equals that skill's `metadata.version` at
the tagged commit.

## Security model

Installing a skill installs code that runs in-process with the runtime's
authority, so the trust anchor is the registry operator: every published tag
is operator-reviewed, and third-party PRs are never auto-tagged. The committed
digest lock makes post-review tampering (a moved tag, a poisoned cache)
detectable everywhere and fatal at build time. Byte caps and the extraction
whitelist bound what a hostile tarball can do before validation rejects it.
