import { hostname } from "node:os";
import { ConfigError, errorMessage, isTaggedError } from "../../core/errors.js";
import type {
  BuildErrorReporterOpts,
  BuildEventCtx,
  ErrorReporter,
  GlitchtipDsn,
  GlitchtipFetch,
  GlitchtipOpts,
  SentryEvent,
  SentryExceptionValue,
  SentryFrame,
} from "./types.js";

/**
 * GlitchTip exception reporting (§12) — a minimal hand-rolled Sentry-protocol
 * client. Deliberately NO `@sentry/*` SDK (ARCHITECTURE §12 "No Sentry"); we
 * implement the wire format ourselves: parse the DSN at boot, parse V8/Bun
 * stacks into Sentry frames, walk `error.cause` chains into `exception.values`,
 * and POST to the live-verified `{origin}/api/{projectId}/store/` endpoint.
 * Captures are fire-and-forget and NEVER throw — a broken reporter must not be
 * able to take anything else down (§1.4).
 */

const SENTRY_CLIENT = "agent-kit/0.0.0"; // keep in step with package.json
const MAX_CAUSE_CHAIN = 5;
const FAILURE_REPORT_EVERY = 10;

/** Parse a Sentry DSN. Malformed → ConfigError at boot, not at capture time. */
export function parseDsn(dsn: string): GlitchtipDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ConfigError({ message: `glitchtip: malformed DSN '${dsn}'` });
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!/^https?:$/.test(url.protocol) || !url.username || !projectId) {
    throw new ConfigError({
      message: "glitchtip: DSN must look like https://<key>@<host>/<projectId>",
    });
  }
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    origin: `${url.origin}${prefix}`,
    projectId,
    publicKey: url.username,
  };
}

/**
 * Parse a V8/Bun `Error.stack` into Sentry frames — `at fn (file:line:col)`
 * and bare `at file:line:col` forms, `async` prefixes, `new Fn`, anonymous.
 * Returned oldest-call-first per Sentry convention (V8 prints newest first).
 */
export function parseStack(error: Error): SentryFrame[] {
  const frames: SentryFrame[] = [];
  for (const line of (error.stack ?? "").split("\n")) {
    const frame = parseFrameLine(line);
    if (frame) frames.push(frame);
  }
  return frames.toReversed();
}

function parseFrameLine(line: string): SentryFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("at ")) return undefined;
  let rest = trimmed.slice("at ".length).trim();
  if (rest.startsWith("async ")) rest = rest.slice("async ".length);
  // `fn (file:line:col)` vs bare `file:line:col`.
  const openParen = rest.endsWith(")") ? rest.indexOf(" (") : -1;
  const fn = openParen === -1 ? undefined : rest.slice(0, openParen);
  const location = openParen === -1
    ? rest
    : rest.slice(openParen + " (".length, -1);
  return {
    ...(fn && fn !== "<anonymous>" && { function: fn }),
    ...parseLocation(location),
  };
}

function parseLocation(location: string): SentryFrame {
  const positioned = /^(.*):(\d+):(\d+)$/.exec(location);
  const rawFile = positioned ? positioned[1]! : location;
  const filename = rawFile.startsWith("file://")
    ? rawFile.slice("file://".length)
    : rawFile;
  return {
    filename,
    ...(positioned && {
      lineno: Number(positioned[2]),
      colno: Number(positioned[3]),
    }),
    in_app: isInApp(filename),
  };
}

function isInApp(filename: string): boolean {
  return (
    !filename.includes("node_modules")
    && !filename.startsWith("node:")
    && !filename.startsWith("bun:")
  );
}

/**
 * Build one Sentry event from a throwable. Walks the `error.cause` chain (cap
 * 5) into `exception.values`, innermost (root cause) first per Sentry; a
 * non-Error throwable becomes a synthesized value with `synthetic: true`.
 */
export function buildEvent(error: unknown, ctx: BuildEventCtx): SentryEvent {
  const mechanism = ctx.mechanism ?? "generic";
  const handled = ctx.handled ?? true;
  const values = causeChain(error)
    .map((cause) => toExceptionValue(cause, mechanism, handled))
    .toReversed();
  return {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: ctx.level ?? "error",
    logger: ctx.logger ?? "agent-kit",
    ...(ctx.serverName && { server_name: ctx.serverName }),
    ...(ctx.environment && { environment: ctx.environment }),
    ...(ctx.release && { release: ctx.release }),
    ...(ctx.tags && { tags: ctx.tags }),
    ...(ctx.extra && { extra: ctx.extra }),
    exception: { values },
  };
}

/** Outermost first; capped so a self-referential cause can't loop forever. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (
    current !== undefined && current !== null
    && chain.length < MAX_CAUSE_CHAIN
  ) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function toExceptionValue(
  error: unknown,
  mechanism: string,
  handled: boolean,
): SentryExceptionValue {
  if (error instanceof Error) {
    const frames = parseStack(error);
    return {
      type: isTaggedError(error) ? error._tag : error.name || "Error",
      value: error.message,
      ...(frames.length > 0 && { stacktrace: { frames } }),
      mechanism: { type: mechanism, handled },
    };
  }
  return {
    type: "Error",
    value: errorMessage(error),
    mechanism: { type: mechanism, handled, synthetic: true },
  };
}

/** For when the `observability.glitchtip` section is unconfigured. */
export const noopReporter: ErrorReporter = {
  captureException() {},
  flush: () => Promise.resolve(),
};

/**
 * Build the reporter. `parseDsn` failures surface here — at boot. Captures
 * dedupe by error-object identity so one failure propagating through stacked
 * seams (turn → schedule → job queue) reports once, from the innermost seam.
 */
export function makeGlitchtip(opts: GlitchtipOpts): ErrorReporter {
  const sender = makeSender(opts, parseDsn(opts.dsn));
  const seen = new WeakSet<object>();
  return {
    captureException(error, ctx) {
      try {
        if (typeof error === "object" && error !== null) {
          if (seen.has(error)) return;
          seen.add(error);
        }
        sender.send(buildEvent(error, {
          ...ctx,
          ...(opts.environment && { environment: opts.environment }),
          ...(opts.release && { release: opts.release }),
          ...(opts.serverName && { serverName: opts.serverName }),
        }));
      } catch (error_) {
        sender.recordFailure(error_); // a capture failure never crashes anything
      }
    },
    flush(timeoutMs) {
      const pending = Promise.allSettled(sender.inflight);
      return Promise.race([pending, sleep(timeoutMs)]).then(() => undefined);
    },
  };
}

function makeSender(opts: GlitchtipOpts, dsn: GlitchtipDsn): {
  send: (event: SentryEvent) => void;
  recordFailure: (cause: unknown) => void;
  inflight: Set<Promise<void>>;
} {
  const url = `${dsn.origin}/api/${dsn.projectId}/store/`;
  const auth = `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, `
    + `sentry_client=${SENTRY_CLIENT}`;
  const fetchImpl: GlitchtipFetch = opts.fetchImpl
    ?? ((target, init) => fetch(target, init));
  const inflight = new Set<Promise<void>>();
  let failures = 0;
  const recordFailure = (cause: unknown): void => {
    failures += 1;
    if (failures % FAILURE_REPORT_EVERY === 1) {
      try {
        opts.onError?.(cause, failures);
      } catch {
        /* even the failure hook must not throw into callers */
      }
    }
  };
  const send = (event: SentryEvent): void => {
    const request: Promise<void> = Promise.try(() =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": auth,
        },
        body: JSON.stringify(event),
      })
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`glitchtip store returned ${response.status}`);
        }
      })
      .catch(recordFailure)
      .finally(() => inflight.delete(request));
    inflight.add(request);
  };
  return { send, recordFailure, inflight };
}

/**
 * Reporter from the optional config section (§5 semantics): absent → noop;
 * invalid DSN → noop + one error event via `onInvalid`, never a boot failure.
 */
export function buildErrorReporter(
  opts: BuildErrorReporterOpts,
): ErrorReporter {
  const section = opts.glitchtip;
  if (!section) return noopReporter;
  try {
    return makeGlitchtip({
      dsn: section.dsn,
      environment: section.environment ?? opts.environment,
      serverName: hostname(),
      ...(section.release && { release: section.release }),
    });
  } catch (error) {
    opts.onInvalid?.(
      `glitchtip: ${errorMessage(error)} — exception reporting disabled`,
    );
    return noopReporter;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
