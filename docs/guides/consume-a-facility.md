# How to consume a facility from another skill

A facility is infrastructure one skill offers to others: a proxy route, a local
DNS record, a verified webhook endpoint. You acquire a grant during your own
`register()`.

Background: [Facilities](../explanation/facilities.md).

## Find out what is available

```typescript
context.facilities.list();            // every descriptor
context.facilities.describe(id);      // one, or undefined
```

Each descriptor carries a `requestSchema` for what `acquire` accepts and a
`grantSchema` for what comes back.

## Acquire a grant

```typescript
export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const grant = await context.facilities.acquire(
    "core/proxy.route",           // facility id
    "my-skill-public-route",      // grant name, unique within your skill
    { hostname: "map.example.com", serviceUrl: "http://10.0.0.5:8080" },
  );

  return {
    routes: [routeUsing(grant.values)],
  };
};
```

Providers register before consumers, so a facility another skill declares in its
manifest `spec.provides` is ready by the time your `register()` runs.

## What the loader does for you

Your consumer identity comes from your package's `metadata.name` and is stamped
by the loader. You cannot set it, and no other skill can claim it.

Grants persist. Re-acquiring with the same name returns the stored grant instead
of provisioning a second resource, so a public URL you registered with Slack
survives a reboot.

## If the provider is not installed

`acquire` throws, your `register()` fails, and the runtime reports it and boots
without your skill. That is the designed degrade path. Cover it with a smoke
test so the failure is loud in CI instead of silent in production. See
[Write a skill smoke test](write-a-skill-smoke-test.md).

## Releasing

```typescript
await context.facilities.release(grantId);
```

This tears down the provisioned resource. The runtime never calls it for you.
Release a grant only when you mean to destroy what it provisioned.

## Exact contracts

Descriptor, request, and grant shapes are in the
[SkillContext reference](../reference/api/skill-context.md).
