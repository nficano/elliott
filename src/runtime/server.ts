import type { BundledPackage } from "../catalog/types";

// Bun.serve severs connections with no activity after 10 seconds by default,
// which is shorter than two long-lived routes need: the telemetry map's
// /send holds the request open for up to 180s while a turn runs, and its SSE
// stream can sit quiet for 15s between heartbeats. 255 is Bun's maximum
// (uint8 seconds).
const IDLE_TIMEOUT_SECONDS = 255;

export const startRuntimeServer = (
  port: number,
  handler: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    port,
    hostname: "0.0.0.0",
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: handler,
  });

export const runtimeComponentSummary = (
  packages: readonly BundledPackage[],
) =>
  packages.map((item) => ({
    name: item.name,
    kind: item.kind,
    protocols: item.protocols,
  }));
