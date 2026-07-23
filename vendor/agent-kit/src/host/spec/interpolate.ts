import type {
  DeferredExpr,
  DeferredSegment,
  ExprOperand,
  ExprSegment,
  PathOperand,
  SpecLoadContext,
  SpecRuntimeContext,
} from "./types.js";

/**
 * `${{ }}` interpolation (AGENT-SPEC §1.3), two phases:
 *
 *  - LOAD: `secrets.<name>` (consumer config/secrets.yaml, already
 *    `${VAULT/ENV}`-resolved) and `config.<path>` (the spec's own `config:`
 *    block) resolve eagerly; an unknown name is a load error naming the spec
 *    file and the expression.
 *  - RUNTIME: `steps.<id>.outputs<.path>` survives load as a DeferredExpr node
 *    attached where the value goes, and resolves during job execution.
 *
 * The expression language is deliberately tiny: dotted paths and binary `+`
 * (array concat / string concat; number add). A `${{ }}` that is the WHOLE
 * YAML scalar preserves the resolved type; embedded in a longer string it
 * stringifies.
 */

export class SpecInterpolationError extends Error {}

const EXPR = /\$\{\{([^{}]*)\}\}/g;
const PATH = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;
const ROOTS = new Set(["secrets", "config", "steps"]);

/** Phase 1: resolve load-time contexts; defer `steps.*` as DeferredExpr nodes. */
export function interpolateSpecTree(
  tree: unknown,
  ctx: SpecLoadContext,
): unknown {
  if (typeof tree === "string") return interpolateString(tree, ctx);
  if (Array.isArray(tree)) {
    return tree.map((v) => interpolateSpecTree(v, ctx));
  }
  if (isRecord(tree)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tree)) {
      out[k] = interpolateSpecTree(v, ctx);
    }
    return out;
  }
  return tree;
}

/** Phase 2: resolve DeferredExpr nodes against `steps.<id>.outputs`. */
export function resolveDeferredTree(
  tree: unknown,
  runtime: SpecRuntimeContext,
): unknown {
  if (isDeferredExpr(tree)) return resolveDeferredExpr(tree, runtime);
  if (Array.isArray(tree)) {
    return tree.map((v) => resolveDeferredTree(v, runtime));
  }
  if (isRecord(tree)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tree)) {
      out[k] = resolveDeferredTree(v, runtime);
    }
    return out;
  }
  return tree;
}

export function isDeferredExpr(value: unknown): value is DeferredExpr {
  return isRecord(value) && value.kind === "spec-expr"
    && typeof value.source === "string" && Array.isArray(value.segments);
}

/** True when any DeferredExpr survives in the tree. */
export function hasDeferred(tree: unknown): boolean {
  if (isDeferredExpr(tree)) return true;
  if (Array.isArray(tree)) return tree.some(hasDeferred);
  if (isRecord(tree)) return Object.values(tree).some(hasDeferred);
  return false;
}

// ── phase 1 ──

function interpolateString(s: string, ctx: SpecLoadContext): unknown {
  const segments = parseSegments(s, ctx.file);
  if (!segments.some((seg) => seg.type === "expr")) return s;
  const resolved: DeferredSegment[] = segments.map((seg) =>
    seg.type === "expr"
      ? {
        type: "expr",
        operands: seg.operands.map((op) => resolveLoadOperand(op, ctx, s)),
      }
      : seg
  );
  const isDeferred = resolved.some((seg) =>
    seg.type === "expr" && seg.operands.some((op) => op.type === "path")
  );
  if (isDeferred) {
    return {
      kind: "spec-expr",
      source: s,
      file: ctx.file,
      segments: resolved,
    } satisfies DeferredExpr;
  }
  return evaluateSegments(resolved, s);
}

function parseSegments(s: string, file: string): DeferredSegment[] {
  const segments: DeferredSegment[] = [];
  let last = 0;
  for (const m of s.matchAll(EXPR)) {
    if (m.index > last) {
      segments.push({ type: "text", text: s.slice(last, m.index) });
    }
    segments.push({
      type: "expr",
      operands: parseExpression({ expr: m[1]!, source: s, file }),
    });
    last = m.index + m[0].length;
  }
  if (last < s.length) segments.push({ type: "text", text: s.slice(last) });
  return segments;
}

function parseExpression(params: {
  readonly expr: string;
  readonly source: string;
  readonly file: string;
}): PathOperand[] {
  const { expr, source, file } = params;
  const parts = expr.split("+").map((p) => p.trim());
  return parts.map((part) => {
    if (part.length === 0 || !PATH.test(part)) {
      throw new SpecInterpolationError(
        `${file}: invalid expression "${source}" — operands are dotted paths joined by +`,
      );
    }
    const path = part.split(".");
    if (!ROOTS.has(path[0]!)) {
      throw new SpecInterpolationError(
        `${file}: unknown context "${path[0]}" in "${source}" — use secrets.*, config.*, or steps.*`,
      );
    }
    return { type: "path", path };
  });
}

function resolveLoadOperand(
  op: ExprOperand,
  ctx: SpecLoadContext,
  source: string,
): ExprOperand {
  if (op.type === "value" || op.path[0] === "steps") return op;
  if (op.path[0] === "secrets") {
    const name = op.path.slice(1).join(".");
    const value = ctx.secrets[name];
    if (value === undefined) {
      throw new SpecInterpolationError(
        `${ctx.file}: unknown secret "${name}" in "${source}" — bind it in config/secrets.yaml`,
      );
    }
    return { type: "value", value };
  }
  const value = lookupPath(ctx.config, op.path.slice(1));
  if (value === undefined) {
    throw new SpecInterpolationError(
      `${ctx.file}: unknown config value "${
        op.path.join(".")
      }" in "${source}" — declare it in the spec's config: block`,
    );
  }
  return { type: "value", value };
}

// ── phase 2 ──

function resolveDeferredExpr(
  node: DeferredExpr,
  runtime: SpecRuntimeContext,
): unknown {
  const segments: DeferredSegment[] = node.segments.map((seg) =>
    seg.type === "expr"
      ? {
        type: "expr",
        operands: seg.operands.map((op) => resolveStepOperand(op, node, runtime)),
      }
      : seg
  );
  return evaluateSegments(segments, node.source);
}

function resolveStepOperand(
  op: ExprOperand,
  node: DeferredExpr,
  runtime: SpecRuntimeContext,
): ExprOperand {
  if (op.type === "value") return op;
  // Path shape: steps.<id>.outputs<.path…> — navigate { steps: { id: { outputs } } }.
  const value = lookupPath({ steps: runtime.steps }, normalizeStepPath(op, node));
  if (value === undefined) {
    throw new SpecInterpolationError(
      `${node.file}: "${op.path.join(".")}" did not resolve in "${node.source}"`
        + ` — known steps: [${Object.keys(runtime.steps).join(", ")}]`,
    );
  }
  return { type: "value", value };
}

function normalizeStepPath(op: PathOperand, node: DeferredExpr): string[] {
  const [root, stepId, outputs, ...rest] = op.path;
  if (root !== "steps" || stepId === undefined || outputs !== "outputs") {
    throw new SpecInterpolationError(
      `${node.file}: runtime expressions are steps.<id>.outputs<.path>, got "${
        op.path.join(".")
      }" in "${node.source}"`,
    );
  }
  return ["steps", stepId, ...rest];
}

// ── evaluation ──

function evaluateSegments(
  segments: readonly DeferredSegment[],
  source: string,
): unknown {
  const isWhole = segments.length === 1 && segments[0]!.type === "expr";
  if (isWhole) {
    return evaluateExpr(segments[0] as ExprSegment, source);
  }
  return segments
    .map((seg) =>
      seg.type === "text"
        ? seg.text
        : stringifyValue(evaluateExpr(seg, source), source)
    )
    .join("");
}

function evaluateExpr(seg: ExprSegment, source: string): unknown {
  const values = seg.operands.map((op) => {
    if (op.type !== "value") {
      throw new SpecInterpolationError(
        `unresolved runtime expression "${source}" — resolveDeferredTree must run first`,
      );
    }
    return op.value;
  });
  return values.reduce((acc, v) => combine({ a: acc, b: v, source }));
}

/** Binary `+`: array concat / string concat; number add. */
function combine(params: {
  readonly a: unknown;
  readonly b: unknown;
  readonly source: string;
}): unknown {
  const { a, b, source } = params;
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (typeof a === "string" || typeof b === "string") {
    return stringifyValue(a, source) + stringifyValue(b, source);
  }
  throw new SpecInterpolationError(
    `cannot apply + to ${describeType(a)} and ${describeType(b)} in "${source}"`,
  );
}

function stringifyValue(value: unknown, source: string): string {
  if (typeof value === "string") return value;
  if (value === undefined) {
    throw new SpecInterpolationError(
      `cannot stringify undefined in "${source}"`,
    );
  }
  if (value === null || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value as number | boolean);
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function lookupPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
