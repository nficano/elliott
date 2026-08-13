# HTTP API

One Bun process serves every route. The port is `ELLIOTT_HTTP_PORT`, else
`runtime.http.port`, else `8080`.

Resolution order is fixed: `/healthz`, `/v1/components`, the two control planes,
then the skill route table, then 404. A control-plane path whose capability is
absent falls through to the route table. Skill routes match on exact `method`
and `path`, first match wins.

## `GET /healthz`

Returns 200 when `ready` is true, 503 when it is false.

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `ready` | boolean | false while booting, or when a required install entry is not `ok` |
| `release` | string | `ELLIOTT_RELEASE`, default `dev` |
| `skills` | number | packages loaded |
| `tools` | number | tools registered |
| `gateways` | `Record<string, string>` | per-gateway status |
| `services` | `Record<string, Record<string, number>>` | per-service health counters |
| `install` | `InstallHealth[]` | present only when an `install:` block is configured |

```json
{"ready":true,"release":"dev","skills":23,"tools":7,
 "gateways":{"deep-trace":"active"},
 "services":{"deep-trace":{"turns":0,"events":3,"clients":0,"dbTables":12},
             "glitchtip":{"queued":0,"sent":0,"dropped":0},"scheduler":{}}}
```

`skills` counts packages that loaded. `tools` counts tools that registered. The
two differ whenever a package is dormant.

### `InstallHealth`

| Field | Type |
| :--- | :--- |
| `skill` | string |
| `requested` | string |
| `resolved` | string, optional |
| `state` | `ok` \| `cached-fallback` \| `failed` |
| `required` | boolean |
| `error` | string, optional |

`ready` is false when any entry with `required: true` has a state other than
`ok`. Gateways default to required.

## `GET /v1/components`

Returns one entry per loaded package. It does not report registration outcome.

```json
[{"name":"fetch","kind":"tool","protocols":["tool.executor"]}]
```

## `POST /v1/control/governance`

Present only when `ELLIOTT_GOVERNANCE_TOKEN` is set. Without it the path falls
through to the route table and usually 404s.

Authentication is `Authorization: Bearer <token>`, compared in constant time.

| Operation | Body |
| :--- | :--- |
| read state | `GET` with no body |
| disable one tool | `{"op":"disable","tool":"<name>"}` |
| freeze all tools | `{"op":"freeze"}` |
| restore | `{"op":"unfreeze"}` |

Toggles are written to the audit trail and do not survive a restart. For a
standing denial use `governance.deny` in `config/elliott.yaml`.

## `POST /v1/control/evolution`

Present only when `ELLIOTT_EVOLUTION_CONTROL_TOKEN`,
`ELLIOTT_EVOLUTION_OPERATOR_PRINCIPAL`, and
`ELLIOTT_EVOLUTION_OPERATOR_CAPABILITIES` are all set. Same bearer scheme.

## Skill routes

A skill returns `RouteBinding`s from `register()`. Each carries a `method`, a
`path`, and `handle(request, events) => Response`. Duplicate `method` plus
`path` pairs are rejected by the contract smoke test rather than at runtime.

Routes mount after the built-in paths above, so a skill cannot shadow `/healthz`
or either control plane.

## Message ingress

Gateways, not HTTP routes, carry conversational traffic. Inbound messages are
deduplicated by message id and keyed on `gateway:channel:thread`. A second
concurrent turn on the same key is rejected. Replies go back through the
originating gateway when it can send, else the primary gateway, which is the
first gateway with both a `send` and a `defaultChannel`, else the first with a
`send`.
