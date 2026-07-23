import { ConfigError, errorMessage } from "../../core/errors.js";
import { envResolver, interpolate } from "./interpolate.js";
import {
  applyOverlay,
  loadConfig,
  mergeSource,
  readSnapshot,
  validate,
  writeSnapshot,
} from "./load.js";
import type { AgentKitConfig } from "./schema.js";
import type { LoadOptions, SecretResolver } from "./types.js";

/**
 * Holds the live config reference and mediates hot reload (§5).
 *
 * - A turn/job captures a snapshot at child-scope creation (§4). In-flight turns
 *   keep the config they started with; new turns pick up the swapped root — a
 *   mid-turn tier/budget change can't produce unattributable behavior.
 * - `/config/reload` re-merges + re-interpolates + validates; on success it
 *   swaps the root reference and re-snapshots last-known-good; on failure it
 *   recovers from last-known-good and reports, never wedging the process.
 */
export class ConfigStore {
  private current: AgentKitConfig;
  private readonly opts: LoadOptions & { resolver: SecretResolver; };

  private constructor(
    initial: AgentKitConfig,
    opts: LoadOptions & { resolver: SecretResolver; },
  ) {
    this.current = initial;
    this.opts = opts;
  }

  static async boot(opts: LoadOptions): Promise<ConfigStore> {
    const resolver = opts.resolver ?? envResolver();
    const snapshotPath = opts.snapshotPath ?? "data/last-known-good.yaml";
    const { config } = await loadConfig({ ...opts, resolver, snapshotPath });
    return new ConfigStore(config, { ...opts, resolver, snapshotPath });
  }

  /** The live root config. New child scopes read this at creation (§4). */
  get(): AgentKitConfig {
    return this.current;
  }

  /**
   * Hot reload. Returns `{ ok, needsRestart }` on success or throws only if BOTH
   * the new config AND last-known-good are unusable (unrecoverable).
   */
  async reload(): Promise<
    { applied: boolean; needsRestart: string[]; recovered: boolean; }
  > {
    let next: AgentKitConfig;
    try {
      const source = await mergeSource(
        this.opts.dir,
        this.opts.env,
        this.opts.appName ?? "agent-kit",
      );
      const interpolated = await interpolate(
        applyOverlay(source, this.opts),
        this.opts.resolver,
      );
      next = validate(interpolated);
      // Success → this becomes the new last-known-good (pre-interpolation source).
      if (this.opts.snapshotPath) {
        await writeSnapshot(this.opts.snapshotPath, source);
      }
    } catch (error) {
      const isRecovered = await this.recoverFromSnapshot();
      if (!isRecovered) {
        throw new ConfigError({
          message: `reload failed and no usable last-known-good: ${
            errorMessage(error)
          }`,
        });
      }
      return { applied: false, needsRestart: [], recovered: true };
    }
    const needsRestart = diffRestartSections(this.current, next);
    this.current = next;
    return { applied: true, needsRestart, recovered: false };
  }

  private async recoverFromSnapshot(): Promise<boolean> {
    if (!this.opts.snapshotPath) return false;
    const snap = await readSnapshot(this.opts.snapshotPath);
    if (!snap) return false;
    try {
      const interpolated = await interpolate(
        applyOverlay(snap, this.opts),
        this.opts.resolver,
      );
      this.current = validate(interpolated);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Which changed sections require a restart vs hot-apply (§5). Schedules, budgets,
 * routing hot-apply; store/llm/http changes need a restart.
 */
function diffRestartSections(a: AgentKitConfig, b: AgentKitConfig): string[] {
  const restartKeys: (keyof AgentKitConfig)[] = [
    "store",
    "llm",
    "runtime",
    "observability",
  ];
  const out: string[] = [];
  for (const k of restartKeys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}
