import { isJsonRecord } from "../../../src/providers/http";
import type { TunnelReadiness } from "./types";

const PROBE_TIMEOUT_MILLISECONDS = 5000;
const HTTP_OK = 200;

// cloudflared's metrics server answers /ready with a JSON body carrying
// `readyConnections` — the count of established connections to Cloudflare's
// edge. A 200 with zero ready connections means the process is alive but
// routing nothing, which for inbound webhooks is the same as down, so it is
// NOT treated as ready.
export const readTunnelReadiness = (value: unknown): TunnelReadiness => {
  if (!isJsonRecord(value)) {
    return { ready: false, readyConnections: 0, reason: "unreadable response" };
  }
  const connections = value["readyConnections"];
  const count = typeof connections === "number" && Number.isFinite(connections)
    ? connections
    : 0;
  return count > 0
    ? { ready: true, readyConnections: count }
    : { ready: false, readyConnections: count, reason: "no edge connections" };
};

// Probe the local metrics endpoint. Every failure is reported as a phrase from
// a closed set this repo owns — never the fetch error's text, which can carry
// the URL and any credential an operator embedded in it.
export const probeTunnel = async (url: string): Promise<TunnelReadiness> => {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
    });
  } catch {
    return {
      ready: false,
      readyConnections: 0,
      reason: "metrics endpoint unreachable",
    };
  }
  if (response.status !== HTTP_OK) {
    return {
      ready: false,
      readyConnections: 0,
      reason: `metrics endpoint returned HTTP ${response.status}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ready: false, readyConnections: 0, reason: "unreadable response" };
  }
  return readTunnelReadiness(body);
};
