# How to consume a facility from another skill

Facilities are the fifth binding kind: one skill *provides* infrastructure
(a Traefik route, a Pi-hole DNS record, a webhook ingress) and other skills
*acquire* grants from it during their own `register()`. Background:
[Skill facilities](../explanation/skill-facilities.md).

## Acquire a grant

Inside `register(context)`, use the facility directory:

```typescript
export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const grant = await context.facilities.acquire(
    "core/proxy.route",         // facility id
    "my-skill-public-route",    // grant name, unique per consumer
    { hostname: "map.example.com", serviceUrl: "http://10.0.0.5:8080" },
  );
  // grant.values holds what the provider provisioned for you
  return { /* bindings that use grant.values */ };
};
```

Notes:

- The `consumer` identity on the request is stamped by the loader from
  your package's `metadata.name` — it is never caller-supplied, so one
  skill cannot impersonate another.
- Discover what a facility accepts with `context.facilities.list()` /
  `describe(id)`; each descriptor carries a `requestSchema` and
  `grantSchema`.
- Providers register before consumers (two-pass loader), so a facility
  declared in another skill's manifest `spec.provides` is available by the
  time your `register()` runs. If the provider is not installed, `acquire`
  fails and your skill degrades — boot continues.
- Grants are stored; a re-registering consumer gets its stored grant back
  without re-provisioning.

## Release

`context.facilities.release(grantId)` tears down the provisioned resource.
It is destructive and never called implicitly by the runtime — only
release a grant you mean to destroy.

## Exact contracts

Descriptor, request, and grant shapes are in the
[`register()` seam reference](../reference/api/skill-context.md).
