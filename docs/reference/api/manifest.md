# `manifest.yaml`

Every skill package is a directory holding a `manifest.yaml`. The JSON-Schema
authority is
[`schemas/elliott-component.json`](../../../schemas/elliott-component.json).

## Shape

```yaml
apiVersion: elliott/v1
kind: tool
profile: tool-standard
metadata: { namespace: core, name: fetch, version: 1.0.0 }
spec:
  document: TOOL.md
  protocols: [tool.executor]
  capabilities:
    - { capability: network.connect, resources: [declared://request-hosts] }
  egress: { class: declared, hosts: [] }
  isolation: container
  outputTrust: untrusted
  provides: []
  topology:
    node: { id: tool.fetch, kind: tool, domain: external-integrations,
            trustZone: egress, dataClassification: untrusted-external,
            criticality: supporting }
    dispatch: tool
    gate: always
    egressTargets: [ public http/https ]
    edges: []
  exports:
    - { ref: tool/fetch-url, implementation: src/index.ts }
```

## Fields

| Field | Notes |
| :--- | :--- |
| `apiVersion` | always `elliott/v1` |
| `kind` | component kind; determines the expected kind document |
| `metadata.namespace` | grouping namespace |
| `metadata.name` | lowercase, digits, hyphens; also the facility-consumer identity |
| `metadata.version` | semver; must equal the git tag version for registry skills |
| `spec.document` | `SKILL.md`, `TOOL.md`, `GATEWAY.md`, `SCHEDULER.md`, and so on, with YAML frontmatter carrying `name` and `description` |
| `spec.protocols` | schema-backed protocols the component implements |
| `spec.capabilities` | requested capabilities; declared, never ambient. `[]` requests nothing |
| `spec.egress` | `{ class: none }` or `{ class: declared, hosts: [...] }` |
| `spec.isolation` | placement isolation, such as `container` |
| `spec.outputTrust` | `untrusted` marks output that enters the loop as evidence |
| `spec.provides` | facility ids this package offers; drives two-pass load order |
| `spec.topology` | consumed by `scripts/gen-topology.mjs` and the deep-trace map. The runtime loader ignores it |
| `spec.exports` | `{ ref, implementation }` pairs. Without this the package is descriptor-only and no code is imported |

## Loader contract

Discovery is static and import-free. The loader reads manifests; an
`implementation` module is imported only to call `register()` at boot, and only
when the manifest declares it.

Packages live in `skills/` (framework-bundled), `agents/<name>/skills/`
(agent-specific), or the installed registry cache. All three use this format and
the same loader in `src/catalog/bundled.ts`.

Both catalogs may use category subdirectories. Discovery finds any directory
containing a `manifest.yaml` and treats it as a package. Component identity
comes from `metadata`, never from the directory path.

## Additional rules for registry skills

- No `package.json` inside a skill directory. A nested one shadows elliott's
  package self-reference and breaks `import "elliott/skills"` in dev mode.
- No npm dependencies. `src/**` imports only `elliott/*` subpath exports,
  Node and Bun builtins, and its own `./` relatives.
- No cross-package imports (`../<other-skill>`).
- The directory name must equal `metadata.name`.
