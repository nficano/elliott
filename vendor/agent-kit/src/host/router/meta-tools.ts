import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/define.js";
import type { ToolCtx, ToolDef } from "../../core/agent/types.js";
import type { MetaTools, RouterAccess } from "./types.js";

const DEFAULT_SEARCH_RESULT_LIMIT = 8;

export type { MetaTools } from "./types.js";

export function makeMetaTools(router: RouterAccess): MetaTools {
  return {
    search: define({
      name: "search_tools",
      description:
        "Discover a tool that isn't already loaded. Use when no current tool fits and you "
        + "suspect a capability exists (e.g. a specific integration). Returns candidate tool "
        + "names + descriptions; call the chosen one via invoke_tool. Not for tools you already see.",
      schema: Schema.Struct({
        query: Schema.String,
        limit: Schema.optional(Schema.Number.check(Schema.isInt())),
      }),
      meta: {
        componentId: "router",
        bundle: "core",
        core: true,
        write: false,
      },
      run: async (args) =>
        JSON.stringify(
          await router.searchTools(
            args.query,
            args.limit ?? DEFAULT_SEARCH_RESULT_LIMIT,
          ),
        ),
    }),
    invoke: makeInvokeTool(router),
  };
}

function makeInvokeTool(router: RouterAccess): ToolDef {
  return define({
    name: "invoke_tool",
    description:
      "Call a long-tail tool discovered via search_tools by name, passing its arguments as a "
      + "JSON string. Prefer a directly-loaded tool when one exists. Arguments are validated "
      + "server-side against the real tool schema before it runs.",
    schema: Schema.Struct({ name: Schema.String, args_json: Schema.String }),
    meta: {
      componentId: "router",
      bundle: "core",
      core: true,
      write: false,
    },
    run: (args, ctx) =>
      invokeTool({
        router,
        name: args.name,
        argsJson: args.args_json,
        ctx,
      }),
  });
}

async function invokeTool({
  router,
  name,
  argsJson,
  ctx,
}: {
  readonly router: RouterAccess;
  readonly name: string;
  readonly argsJson: string;
  readonly ctx: ToolCtx;
}): Promise<string> {
  const def = router.resolveTool(name);
  if (!def) return JSON.stringify({ error: `unknown tool: ${name}` });
  const parsed = parseArguments(argsJson);
  if (!parsed.ok) return JSON.stringify({ error: parsed.message });
  return Effect.runPromise(
    def.execute(parsed.value, ctx).pipe(
      Effect.match({
        onSuccess: (result) => result,
        onFailure: (error) => JSON.stringify({ error: error.message }),
      }),
    ),
  );
}

function parseArguments(json: string):
  | { readonly ok: true; readonly value: unknown; }
  | { readonly ok: false; readonly message: string; }
{
  try {
    return { ok: true, value: json ? JSON.parse(json) : {} };
  } catch {
    return { ok: false, message: "args_json is not valid JSON" };
  }
}
