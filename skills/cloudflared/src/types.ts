// The parsed result of one probe against cloudflared's metrics `/ready`
// endpoint. `readyConnections` is the number of established edge connections
// cloudflared reports; a tunnel with zero is running but routing nothing, which
// is indistinguishable from down as far as inbound webhooks are concerned.
export interface TunnelReadiness {
  readonly ready: boolean;
  readonly readyConnections: number;
  // A phrase this repo owns describing why a probe failed, or undefined on
  // success. Never the endpoint's response body: cloudflared is local and
  // trusted, but the same derive-don't-forward rule applies to every value the
  // runtime prints (see docs/reference/known-issues.md).
  readonly reason?: string;
}

// The watch's running state, folded forward one probe at a time. Kept as a
// value rather than a bag of closure variables so a single probe's effect on it
// is a pure function that can be reasoned about without the timer.
export interface TunnelWatchState {
  readonly ready: boolean;
  readonly readyConnections: number;
  readonly consecutiveFailures: number;
  readonly checks: number;
  readonly lastCheckMs: number;
}

// Injected so tests drive readiness transitions without a socket, a clock, or a
// real timer. `schedule` returns its own cancel function rather than a handle,
// so the caller never needs to know whether it wrapped setInterval.
export interface TunnelProbeDependencies {
  readonly probe: (url: string) => Promise<TunnelReadiness>;
  readonly now: () => number;
  readonly schedule: (
    tick: () => void,
    intervalMilliseconds: number,
  ) => () => void;
  // Returns what it established, or undefined when provisioning is not
  // configured or failed. Injected so tests never reach Cloudflare.
  readonly provision: (
    settings: import("../../../src/runtime/types").CloudflaredSettings,
    input: { servicePort: number; stateDirectory: string; },
  ) => Promise<TunnelProvisionState | undefined>;
}

// What the operator supplies to let elliott provision its own tunnel. The token
// is the highest-blast-radius credential the runtime holds — it can create and
// delete DNS records in the zone — so it arrives as a resolved secret reference
// and never appears in a message, a log, or a persisted artifact.
export interface CloudflareCredentials {
  readonly apiToken: string;
  readonly accountId: string;
  readonly zoneId: string;
}

// One request to Cloudflare's API, already carrying auth. Injected so the
// reconciler is testable without a network and without a real token.
export interface CloudflareApi {
  request: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<CloudflareResult>;
}

// Cloudflare's uniform envelope: `success` plus a `result` payload, or `errors`.
// The reconciler never forwards `errors` verbatim — an API error can echo the
// request, and the request carries the hostname and account id.
export interface CloudflareResult {
  readonly success: boolean;
  readonly result: unknown;
  // A phrase derived from the HTTP status and Cloudflare's numeric error code,
  // never the API's own message text.
  readonly reason?: string;
}

// What one reconcile pass established, and what changed to get there. `changes`
// is what the operator sees in the log — the reason a boot took action.
export interface TunnelProvisionState {
  readonly tunnelId: string;
  readonly hostname: string;
  readonly publicBaseUrl: string;
  readonly changes: readonly string[];
}

// api + credentials + the running change log, threaded through every ensure*
// step of a reconcile pass so each takes what it needs without a four-argument
// signature.
export interface ReconcileContext {
  readonly api: CloudflareApi;
  readonly credentials: CloudflareCredentials;
  readonly changes: string[];
}
