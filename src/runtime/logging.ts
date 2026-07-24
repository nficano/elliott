import type { RuntimeStartedEvent } from "./types";

export const logRuntimeStarted = (event: RuntimeStartedEvent): void => {
  console.info(JSON.stringify({
    event: "elliott.runtime.started",
    ...event,
  }));
};
