import type * as ManagedRuntime from "effect/ManagedRuntime";
import { handleInbound as handleInboundProgram } from "./inbound.js";
import { runTurn as runTurnProgram } from "./turn.js";
import type { RuntimeApi, RuntimeServices } from "./types.js";

export { handleInbound } from "./inbound.js";
export { runTurn } from "./turn.js";

/**
 * Bind the turn programs to the app `ManagedRuntime` and expose them as a Promise
 * façade. Channel callbacks and other edges remain Promise-based while the
 * orchestration internals use Effect.
 */
export function makeRuntimeApi(
  runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>,
): RuntimeApi {
  return {
    handleInbound: (message) =>
      runtime.runPromise(handleInboundProgram(message)),
    runTurn: (input) => runtime.runPromise(runTurnProgram(input)),
  };
}
