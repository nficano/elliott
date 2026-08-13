# The skills registry

Installing a skill installs code that runs in-process with the runtime's
authority. Everything about the registry design follows from taking that
sentence seriously.

## Three sources, one contract

The loader knows bundled `skills/`, the agent repo's `agents/<name>/skills/`,
and installed registry skills. All three are `manifest.yaml` plus a kind
document plus `src/` exporting `register(context)`.

There is no second contract for installed skills. They get the same loader, the
same facility system, the same governance wrapping their tools, and the same
appearance in `SkillContext.packages()` and on the deep-trace map. A registry
skill is not a lesser citizen, which is why the trust question below has to be
answered properly.

## Layout and tagging

A registry is a monorepo where each top-level directory is one skill.

```
<owner>/<registry>
├── .github/workflows/ci.yml
└── hello-web/
    ├── manifest.yaml           # metadata.name MUST equal the directory name
    ├── SKILL.md
    └── src/…
```

Versioning is per-skill git tags, `<name>/v<major>.<minor>.<patch>`. At the
tagged commit the skill's `metadata.version` must equal the tag version, checked
by registry CI at tag push and re-verified by the installer.

"Latest" means semver-max, not chronologically newest: the highest
`major.minor.patch` among tags matching `<name>/v*` that parse as exactly three
integers. Prerelease and build suffixes are excluded. Chronological "latest"
would let a hotfix tag on an old branch outrank a newer release.

Two constraints exist for mechanical reasons rather than security ones. A skill
directory may not contain a `package.json`, because a nested one shadows
elliott's package self-reference and breaks `import "elliott/skills"` in dev
mode. And `src/**` imports only `elliott/*` subpath exports, Node and Bun
builtins, and its own relatives, so a skill cannot pull an npm dependency or
reach into a sibling skill.

## Installation happens at build time

There is one code path, the installer, exposed as `elliott skills install`,
invoked in two places.

At **image build** it runs frozen: read the committed `skills.lock.json`, fetch
exactly the locked tags, verify each against its locked digest, materialize into
an image layer. No version resolution happens. An unreachable registry or a
digest mismatch fails the build, which is the correct place to fail.

At **boot**, only with `refresh: true` and only where state is writable, the
runtime re-resolves unpinned entries and rewrites the lock. In a read-only
production container this is a no-op read of the baked cache.

So "latest" resolves when you build or refresh, and that resolution freezes into
the committed lock that ships. A booted container never depends on the registry
host being up.

## Why the float is gated

A tag higher than the locked version is a candidate, not an upgrade. The
installer fetches it, validates it, updates the lock, and logs the change only
during an explicit refresh run.

Production never refreshes, so pushing `hello-web/v99.0.0` cannot silently
become law on the next restart. First install of a brand-new entry does fetch
latest and record it, which is the one unavoidable trust-on-first-use moment.

## The digest is what makes the lock real

For each locked entry the installer groups by the commit its tag points to and
fetches each unique commit's tarball once, so a bulk tag drop shares one
download. It streams to a temp file under hard byte caps on both the compressed
download and the decompressed output.

Extraction uses the system `tar`, because GitHub tarballs are pax format and a
hand-rolled ustar parser misreads them. Only the skill subtree is whitelisted:
regular files and directories, rejecting anything that escapes it.

Then it computes an all-files digest, sha256 over every extracted file's
relative path and bytes, sorted, and compares it to the locked value. Two
containers built from the same commit get byte-identical skills regardless of
what landed upstream since.

Validation runs before the digest check: manifest parses, `apiVersion` is
`elliott/v1`, `metadata.name` matches, `metadata.version` matches, entrypoint
exists, no nested `package.json`, no sibling imports. Any failure caches nothing
and is fatal under a frozen install.

## Fatal versus degraded

The line is drawn between configuration errors and environmental ones.

Bad entry grammar, duplicates, a name colliding with a bundled or agent-local
skill, and an unknown name with no lock entry are all fatal. A grammar-valid
typo could never have been a working config, so failing loud beats skipping
quietly.

A registry that is down, or a missing non-required cached skill, degrades.
Entries with a lock line and intact cache load from cache; entries with neither
are skipped and reported.

A degraded boot must not report itself healthy, so install entries carry a
`required` marker, gateways default to required, `/healthz` grows an `install`
section, and `ready` is false when any required entry is not `ok`.

## What the trust actually rests on

Not the digest. The digest makes tampering detectable; it does not make the code
safe.

The trust anchor is the registry operator. Every published tag is
operator-reviewed and third-party pull requests are never auto-tagged. The
committed digest lock makes post-review tampering, a moved tag or a poisoned
cache, detectable everywhere and fatal at build time. Byte caps and the
extraction whitelist bound what a hostile tarball can do in the window before
validation rejects it.

If you point `install.registry` at a repository you do not control, you have
adopted its operator's review standards as your own. Changing the field is
advisory and does not invalidate existing digests, since that would be a
downgrade lever; a registry change should be a loud, operator-confirmed refresh.

## How installed skills see configuration

`register()` is arbitrary code running before the governor wraps anything, so
the `SkillContext` it receives is scoped. Installed skills get their own config
block plus only the secret grants their manifest declares, not the global secret
bag. Control-plane secrets, including the governance kill-switch bearer, appear
on no `SkillContext` at all.

Practical steps: [Install skills from the registry](../guides/install-registry-skills.md).
