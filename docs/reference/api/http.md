# API reference: the runtime HTTP surface

Source of truth: `src/runtime/app.ts` (dispatch), `src/runtime/openapi.ts`
(document generation), `src/runtime/skills/types.ts` (`RouteBinding`,
`RouteDocs`).

The runtime serves one HTTP listener (`server.port`, default `18082`). Its
API is described by a generated **OpenAPI 3.1** document at the conventional
well-known path:

```
GET /openapi.json
```

The document is built from the same route registry the dispatcher matches
against — the built-in endpoints below plus every skill `RouteBinding` — so
it cannot drift from what actually serves. It is assembled once per boot, on
first request.

## Built-in endpoints

| Method | Path                     | Purpose                                                       |
| :----- | :----------------------- | :------------------------------------------------------------ |
| GET    | `/healthz`               | Health + readiness; `503` while booting or after a failed required install |
| GET    | `/v1/components`         | Loaded packages (`name`, `kind`, `protocols`)                 |
| POST   | `/v1/control/evolution`  | Evolution control plane (bearer-guarded; only when bound)     |
| GET    | `/v1/control/governance` | Governance freeze state + disabled tools (bearer-guarded; only when bound) |
| POST   | `/v1/control/governance` | Kill switch: `{op: "disable"\|"enable"\|"freeze"\|"unfreeze", tool?}` |
| GET    | `/openapi.json`          | This document                                                 |

Control-plane paths appear in the document only when the corresponding plane
is bound (a control token is configured).

Skill routes are registered through the `routes` binding kind on the
`register()` seam and dispatched by exact `method` + `path` match. The
deep-trace skill, for example, serves its explorer under `/v1/deeptrace`
(aliases `/deeptrace`, `/map`, and the pre-rename `/v1/observability/map`
redirect there).

## Documenting a skill route: `RouteDocs`

`RouteBinding.docs` is optional OpenAPI-facing metadata:

```typescript
interface RouteDocs {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly query?: readonly RouteQueryParameter[];   // name, description, required
  readonly requestBody?: RouteRequestBodyDocs;       // description, contentType, schema?
  readonly responses?: readonly RouteResponseDocs[]; // status, description, contentType?
  readonly hidden?: boolean;                         // omit from the document
}
```

- A route with no `docs` still appears, with a generic
  `"<METHOD> <path>"` summary and a default `200` response.
- `hidden: true` keeps a route out of the document entirely — use it for
  static assets and generated build files, not for API endpoints.
- With no `responses`, the operation gets a default `200 Success`.
