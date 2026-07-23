import type { Health, Lifecycle } from "../core/types.js";
import type { AgentKitConfig } from "../host/config/schema.js";
import { migrate } from "./migrate.js";
import { PostgresStore } from "./store.js";

/**
 * Store as a supervised subsystem (§3). Postgres is the one hard dependency:
 * unavailable at boot → fail fast (start throws, supervisor won't mark ready).
 * Migrations run at start (§3 "in M0; schema changes weekly").
 */
export class StoreSubsystem implements Lifecycle {
  readonly name = "store";
  readonly store: PostgresStore;

  constructor(private readonly cfg: AgentKitConfig) {
    this.store = new PostgresStore(cfg.store);
  }

  async start(): Promise<void> {
    await this.store.start();
    // Fail fast if Postgres is unreachable (§5, §20).
    const health = await this.health();
    if (health.state === "down") {
      await this.store.close();
      throw new Error(`store unavailable at boot: ${health.detail}`);
    }
    try {
      const res = await this.store.run(migrate(this.store.sql));
      if (res.applied.length > 0) {
        console.info(`store: migrations applied ${res.applied.join(", ")}`);
      }
    } catch (error) {
      await this.store.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.store.close();
  }

  async health(): Promise<Health> {
    return this.store.health();
  }
}
