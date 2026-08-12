import type { GlitchTipTarget } from "./types";

const SENTRY_PROTOCOL_VERSION = "7";

export class RuntimeErrorReporter {
  readonly #target: GlitchTipTarget | undefined;
  readonly #environment: string;
  readonly #release: string;

  constructor(dsn: string | undefined, environment: string, release: string) {
    this.#target = dsn === undefined ? undefined : parseDsn(dsn);
    this.#environment = environment;
    this.#release = release;
  }

  capture(error: unknown, mechanism: string): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    console.error(`[${mechanism}] ${failure.message}`);
    if (this.#target === undefined) return;
    void this.#send(failure, mechanism).catch((reportingError: unknown) => {
      const detail = reportingError instanceof Error
        ? reportingError.message
        : String(reportingError);
      console.error(`[glitchtip] ${detail}`);
    });
  }

  async #send(error: Error, mechanism: string): Promise<void> {
    const target = this.#target;
    if (target === undefined) return;
    const envelope = buildSentryEnvelope({
      error,
      mechanism,
      environment: this.#environment,
      release: this.#release,
      eventId: crypto.randomUUID().replaceAll("-", ""),
      timestamp: new Date().toISOString(),
    });
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth":
          `Sentry sentry_version=${SENTRY_PROTOCOL_VERSION}, sentry_key=${target.publicKey}`,
      },
      body: envelope,
    });
    if (!response.ok) {
      throw new Error(`GlitchTip returned HTTP ${response.status}`);
    }
  }
}

// Pure builder for the GlitchTip/Sentry envelope: the event header line, the
// item header line, then the event payload (exception values + mechanism tag),
// newline-joined. The caller supplies the event id and timestamp so this stays
// deterministic.
export const buildSentryEnvelope = (input: {
  readonly error: Error;
  readonly mechanism: string;
  readonly environment: string;
  readonly release: string;
  readonly eventId: string;
  readonly timestamp: string;
}): string => {
  const event = {
    event_id: input.eventId,
    timestamp: input.timestamp,
    platform: "javascript",
    environment: input.environment,
    release: input.release,
    level: "error",
    exception: {
      values: [{ type: input.error.name, value: input.error.message }],
    },
    tags: { mechanism: input.mechanism },
  };
  return [
    JSON.stringify({ event_id: input.eventId, sent_at: input.timestamp }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
};

const parseDsn = (dsn: string): GlitchTipTarget => {
  const url = new URL(dsn);
  const project = url.pathname.split("/").findLast(Boolean);
  if (url.username.length === 0 || project === undefined) {
    throw new Error("GlitchTip DSN is invalid");
  }
  const basePath = url.pathname.slice(
    0,
    url.pathname.lastIndexOf(`/${project}`),
  );
  return {
    publicKey: url.username,
    endpoint:
      `${url.protocol}//${url.host}${basePath}/api/${project}/envelope/`,
  };
};
