import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { ErrorReporterSvc } from "../di/services.js";
import { ToolError } from "../errors.js";
import { countTokens } from "../tokenizer.js";
import type { DefineToolSpec, ToolCtx, ToolDef } from "./types.js";

/**
 * Schema-first tool definition (§7.2). The model-facing JSON Schema is *derived*
 * from the Effect `Schema`; inbound args are decoded against that same schema
 * before `run` — the same validation path `invoke_tool` re-uses server-side for
 * dispatched long-tail tools (§10.1). `run` is a plain async handler; `define`
 * lifts it into the tool's typed `Effect` boundary.
 */
export function define<In>(spec: DefineToolSpec<In>): ToolDef {
  const document = Schema.toJsonSchemaDocument(spec.schema);
  const parameters = Object.keys(document.definitions).length === 0
    ? document.schema
    : { ...document.schema, $defs: document.definitions };
  const cold_tokens = countTokens(
    JSON.stringify({ n: spec.name, d: spec.description, p: parameters }),
  );
  const decode = Schema.decodeUnknownEffect(spec.schema);

  return {
    name: spec.name,
    description: spec.description,
    parameters,
    meta: { ...spec.meta, cold_tokens },
    execute(args: unknown, ctx: ToolCtx): Effect.Effect<string, ToolError> {
      return decode(args).pipe(
        Effect.mapError(
          (parseError) =>
            new ToolError({
              message: `invalid arguments for ${spec.name}: ${
                formatIssues(parseError)
              }`,
            }),
        ),
        Effect.flatMap((parsed) => runTool(spec, parsed, ctx)),
      );
    },
  };
}

/**
 * Execute `spec.run` inside the tool's typed Effect boundary. Real run
 * failures are captured to GlitchTip (§12) at this seam — schema-validation
 * rejections never reach it (noise, handled). `serviceOption` keeps R = never:
 * the reporter rides DI when the app context is present, and is simply absent
 * in bare runPromise call sites (spec-job direct execute, tests).
 */
function runTool<In>(
  spec: DefineToolSpec<In>,
  parsed: In,
  ctx: ToolCtx,
): Effect.Effect<string, ToolError> {
  return Effect.flatMap(
    Effect.serviceOption(ErrorReporterSvc),
    (reporter) =>
      Effect.tryPromise({
        try: () => spec.run(parsed, ctx),
        catch: (cause) => {
          Option.getOrUndefined(reporter)?.captureException(cause, {
            mechanism: "tool",
            handled: true,
            tags: { tool: spec.name, component: spec.meta.componentId },
          });
          return cause instanceof ToolError
            ? cause
            : new ToolError({
              message: `${spec.name} failed: ${describe(cause)}`,
              cause,
            });
        },
      }),
  );
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

/** Render an Effect `SchemaError` as a compact validation message. */
function formatIssues(error: Schema.SchemaError): string {
  return formatSchemaIssue(error.issue);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
