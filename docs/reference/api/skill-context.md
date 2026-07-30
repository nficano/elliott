# API reference: the skill `register()` seam

Source of truth: `src/runtime/skills/types.ts`. A skill's executable module
exports one function:

```typescript
export type SkillRegistrar = (
  context: SkillContext,
) => Promise<SkillRegistration> | SkillRegistration;
```

## `SkillRegistration` — the five binding kinds

```typescript
interface SkillRegistration {
  readonly tools?:      readonly ToolDefinition[];
  readonly gateways?:   readonly GatewayBinding[];
  readonly routes?:     readonly RouteBinding[];
  readonly services?:   readonly ServiceBinding[];
  readonly facilities?: readonly FacilityBinding[];
}
```

| Kind         | What it is                                                        |
| :----------- | :---------------------------------------------------------------- |
| `tools`      | model-callable functions (`name`, `description`, `inputSchema`, `execute(input) → Promise<string>`) |
| `gateways`   | message sources/sinks (`start(events)`, optional `send`, `beginResponse`, `stop`) |
| `routes`     | HTTP routes (`method`, `path`, `handle(request, events) → Response`) |
| `services`   | long-running background workers (`start`, `stop`, optional `health()`) |
| `facilities` | infrastructure offered to *other* skills (below)                  |

## `SkillContext`

```typescript
interface SkillContext {
  readonly settings: RuntimeSettings;      // parsed runtime configuration
  readonly stateDirectory: string;         // per-skill persistent state dir
  readonly facilities: FacilityDirectory;  // scoped to this package
  packages(): readonly SkillPackageView[]; // empty during register();
                                           // full after boot completes
  report(error: unknown, mechanism: string): void; // error telemetry
  deliver(text: string): Promise<void>;    // send via the primary gateway
}
```

`packages()` returns, for every bundled package: `name`, `kind`,
`directory`, `provides` (facility ids from manifest `spec.provides`), the
manifest's `spec.topology` block verbatim, whether `register()` completed
(`registered`), and per-kind binding counts.

## Facilities

A provider returns `FacilityBinding`s; a consumer acquires grants through
`context.facilities`:

```typescript
interface FacilityBinding {
  readonly id: string;            // e.g. "core/proxy.route"
  readonly version: number;
  describe(): FacilityDescriptor; // description + requestSchema + grantSchema
  acquire(request: FacilityRequest): Promise<FacilityGrant>;
  release?(grantId: string): Promise<void>;
}

interface FacilityDirectory {
  list(): readonly FacilityDescriptor[];
  describe(id: string): FacilityDescriptor | undefined;
  acquire(id: string, name: string, config: JsonRecord): Promise<FacilityGrant>;
  release(grantId: string): Promise<void>; // destructive; never implicit
}
```

Contract notes (enforced by the loader, not conventions):

- `FacilityRequest.consumer` is stamped by the loader from the acquiring
  package's `metadata.name`; a skill cannot impersonate another consumer.
- Providers register before consumers (two-pass load), ordered by manifest
  `spec.provides`.
- Grants are persisted (`StoredGrant`); a matching re-acquire returns the
  stored grant without re-invoking the provider.
- `list`/`describe`/`acquire` deliberately mirror MCP's `tools/list` +
  `tools/call` so the same records can back ComponentDiscovery cards.

## Loader behavior

- A package registers only what its `manifest.yaml` `exports` declare —
  see [manifest.md](manifest.md).
- `register()` failures are reported but **boot continues degraded**;
  cover every new skill with a smoke test in `test/integration/skills/`
  (see [the smoke strategy](../../contributing/skill-e2e-smoke-strategy.md)).
