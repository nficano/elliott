// Elliott AgentKernel — the service containing the Registry, Authorizer, and
// Capability Broker (TDD §15a). This is the high-level harness: subsystems
// are constructed and owned here; logs and APIs use standard security
// terminology, never product codenames.
//
// Deferred to M0+: authorizer, broker wiring, snapshot resolution, audit log,
// posture activation (§0e), placement (§2b).

import { EpochRegistry } from "./core/epoch/epochs";
import { ComponentRegistry } from "./core/registry/registry";

export class AgentKernel {
  public readonly registry = new ComponentRegistry();
  public readonly epochs = new EpochRegistry();

  private started = false;

  /** Discovery is static and import-free (§3); instances stay cold until
   *  first brokered use (§2b lazy instantiation). */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("AgentKernel already started");
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }
}
