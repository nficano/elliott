import * as PgClient from "@effect/sql-pg/PgClient";
import * as Redacted from "effect/Redacted";
import type { AgentKitConfig } from "../host/config/schema.js";

/**
 * Add PostgreSQL startup options to the DSN. Startup GUCs apply to every
 * physical connection in the Effect SQL pool.
 */
export function withStartupOptions(
  dsn: string,
  statementTimeoutMs: number,
  lockTimeoutMs: number,
): string {
  const url = new URL(dsn);
  const existing = url.searchParams.get("options")?.trim();
  const settings = [
    `-c statement_timeout=${statementTimeoutMs}`,
    `-c lock_timeout=${lockTimeoutMs}`,
  ];
  url.searchParams.set(
    "options",
    existing ? `${existing} ${settings.join(" ")}` : settings.join(" "),
  );
  return url.href;
}

/** Scoped PostgreSQL pool providing both PgClient and SqlClient services. */
export function createPgLayer(store: AgentKitConfig["store"]) {
  return PgClient.layer({
    url: Redacted.make(
      withStartupOptions(
        store.dsn,
        store.statement_timeout_ms,
        store.lock_timeout_ms,
      ),
    ),
    maxConnections: store.pool.max,
    applicationName: "agent-kit",
  });
}
