# `register()` and `SkillContext`

Source of truth: [`src/runtime/skills/types.ts`](../../../src/runtime/skills/types.ts).

A skill's executable module exports one function:

```typescript
export type SkillRegistrar = (
  context: SkillContext,
) => Promise<SkillRegistration> | SkillRegistration;
```

## `SkillRegistration`

```typescript
interface SkillRegistration {
  readonly tools?: readonly ToolDefinition[];
  readonly gateways?: readonly GatewayBinding[];
  readonly routes?: readonly RouteBinding[];
  readonly services?: readonly ServiceBinding[];
  readonly facilities?: readonly FacilityBinding[];
}
```

| Kind | Shape |
| :--- | :--- |
| `tools` | `name`, `description`, `inputSchema`, `execute(input) => Promise<string>` |
| `gateways` | `start(events)`, optional `send`, `beginResponse`, `stop`, `defaultChannel` |
| `routes` | `method`, `path`, `handle(request, events) => Response` |
| `services` | `start`, `stop`, optional `health()` returning `Record<string, number>` |
| `facilities` | infrastructure offered to other skills |

All five are optional. A `register()` returning `{}` is legal and registers
nothing.

## `SkillContext`

```typescript
interface SkillContext {
  readonly settings: RuntimeSettings;
  readonly stateDirectory: string;
  readonly facilities: FacilityDirectory;
  packages(): readonly SkillPackageView[];
  report(error: unknown, mechanism: string): void;
  installErrorSink(sink: ErrorSink): void;
  deliver(text: string): Promise<void>;
}
```

| Member | Behavior |
| :--- | :--- |
| `settings` | parsed runtime configuration |
| `stateDirectory` | per-skill persistent state directory |
| `facilities` | facility directory, scoped to this package |
| `packages()` | empty during `register()`; populated once boot completes, so route handlers and services see the full list |
| `report(error, mechanism)` | error telemetry |
| `installErrorSink(sink)` | receives every subsequently captured error, normalized and secret-free |
| `deliver(text)` | send through the primary gateway |

`installErrorSink` exists so error reporting can attach without the core runtime
depending on any reporter transport. A skill that installs no sink leaves error
handling at the console baseline.

`SkillContextSeed` is `Omit<SkillContext, "facilities">`: what the runtime hands
the loader before the loader builds and scopes the facility directory per
package.

### `SkillPackageView`

Per bundled package: `name`, `kind`, `directory`, `provides` (facility ids from
manifest `spec.provides`), the manifest's `spec.topology` block verbatim,
`registered`, and per-kind binding counts.

## Facilities

```typescript
interface FacilityBinding {
  readonly id: string;              // "core/proxy.route"
  readonly version: number;         // integer; breaking changes bump it
  describe(): FacilityDescriptor;
  acquire(request: FacilityRequest): Promise<FacilityGrant>;
  release?(grantId: string): Promise<void>;
}

interface FacilityDescriptor {
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly requestSchema: JsonRecord;   // JSON Schema for FacilityRequest.config
  readonly grantSchema: JsonRecord;     // JSON Schema for FacilityGrant.values
}

interface FacilityDirectory {
  list(): readonly FacilityDescriptor[];
  describe(id: string): FacilityDescriptor | undefined;
  acquire(id: string, name: string, config: JsonRecord): Promise<FacilityGrant>;
  release(grantId: string): Promise<void>;
}
```

Contract, enforced by the loader:

- `FacilityRequest.consumer` is stamped from the acquiring package's
  `metadata.name`. A skill cannot present another skill's identity.
- Packages declaring `spec.provides` register first, in a two-pass load.
- Grants persist. The store keys on consumer, facility, and name, so one
  consumer can hold handles across several facilities. A matching re-acquire
  returns the stored grant without re-invoking the provider.
- `release` is destructive and never implicit.
- `list`, `describe`, and `acquire` mirror MCP's `tools/list` and `tools/call`
  so the same records can back ComponentDiscovery cards.

## Loader behavior

A package registers only what its `manifest.yaml` `exports` declares. See
[`manifest.yaml`](manifest.md).

A throwing `register()` is reported and boot continues degraded. Cover every
skill with a smoke test in `test/integration/skills/`; see
[Write a skill smoke test](../../guides/write-a-skill-smoke-test.md).
