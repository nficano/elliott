import type { BundledPackage } from "../catalog/types";

export const startRuntimeServer = (
  port: number,
  handler: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    port,
    hostname: "0.0.0.0",
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
