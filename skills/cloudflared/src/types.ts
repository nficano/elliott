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
}
