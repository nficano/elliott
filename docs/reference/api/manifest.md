# API reference: `manifest.yaml`

Every skill package is a directory containing a `manifest.yaml` authority
manifest. The JSON-Schema authority is
[`schemas/elliott-component.json`](../../../schemas/elliott-component.json);
this page summarizes the fields as used by the bundled packages.

## Shape

```yaml
apiVersion: elliott/v1
kind: tool                      # tool | gateway | scheduler | evaluator | …
profile: tool-standard
metadata: { namespace: core, name: fetch, version: 1.0.0 }
spec:
  document: SKILL.md            # canonical model-visible doc (legacy TOOL.md still accepted)
  protocols: [tool.executor]
  capabilities:                 # requested capabilities; [] = none
    - { capability: network.connect, resources: [declared://request-hosts] }
  egress: { class: declared, hosts: [] }   # or { class: none }
  isolation: container
  outputTrust: untrusted
  provides: []                  # facility ids this package offers
  topology:                     # optional connection-graph metadata
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

## Field notes

| Field               | Notes                                                            |
| :------------------ | :--------------------------------------------------------------- |
| `apiVersion`        | always `elliott/v1`                                              |
| `kind`              | the component kind; determines the expected kind document        |
| `metadata.name`     | lowercase/digits/hyphens; also the facility-consumer identity    |
| `spec.document`     | `SKILL.md` (canonical, agentskills.io); legacy per-kind names (`TOOL.md`, `GATEWAY.md`, `SCHEDULER.md`, …) still accepted — all with YAML frontmatter (`name`, `description`) |
| `spec.protocols`    | schema-backed protocols the component implements                 |
| `spec.capabilities` | requested capabilities — declared, never ambient; empty fails closed |
| `spec.egress`       | `class: none` or `class: declared` with hosts                    |
| `spec.provides`     | facility ids offered to other skills (drives two-pass load order)|
| `spec.topology`     | consumed by `scripts/gen-topology.mjs` and the deep-trace map; ignored by the runtime loader |
| `spec.exports`      | `{ ref, implementation }` — without this the package is descriptor-only and no code is imported |

## Loader contract

- Discovery is static and import-free: the loader reads manifests; the
  `implementation` module is imported only to call `register()` at boot.
- Packages live in `skills/` (framework-bundled) or
  `agents/<name>/skills/` (agent-specific); both use this format and the
  same loader (`src/catalog/bundled.ts`).
