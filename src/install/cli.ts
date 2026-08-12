// `elliott skills install [--frozen] [--refresh]` and `elliott skills lock`.
// install --frozen  : build-time; materialize exactly the committed lock, fail
//                     on any missing entry or digest mismatch.
// install --refresh : dev; re-resolve unpinned to latest and rewrite the lock.
// lock              : alias for install --refresh (regenerate skills.lock.json).

import { loadInstallSettings, runInstall } from "./index";
import { assertNoFatalOutcomes } from "./installer";
import type { InstallMode, InstallOutcome } from "./types";
import { InstallError } from "./types";

const STATE_WIDTH = 15;

const summarize = (outcomes: readonly InstallOutcome[]): string =>
  outcomes
    .map((outcome) => {
      const resolved = outcome.resolved === undefined
        ? ""
        : `@${outcome.resolved}`;
      return `  ${
        outcome.state.padEnd(STATE_WIDTH)
      } ${outcome.skill}${resolved}${
        outcome.error === undefined ? "" : ` — ${outcome.error}`
      }`;
    })
    .join("\n");

// Returns true if it handled the argv, false to let other CLI handlers try.
export const runSkillsCli = async (
  argv: readonly string[],
  agentRoot: string,
): Promise<boolean> => {
  const [command, action, ...flags] = argv;
  if (command !== "skills") return false;
  if (action !== "install" && action !== "lock") {
    throw new InstallError("usage: elliott skills install|lock [--refresh]");
  }
  const settings = await loadInstallSettings(agentRoot);
  if (settings === undefined) {
    console.log("no install: block configured; nothing to do");
    return true;
  }
  const refresh = action === "lock" || flags.includes("--refresh");
  const mode: InstallMode = refresh ? "refresh" : "frozen";
  const result = await runInstall({
    agentRoot,
    settings,
    mode,
    ...(Bun.env["GITHUB_TOKEN"] !== undefined
      && { token: Bun.env["GITHUB_TOKEN"] }),
  });
  console.log(`skills ${action} (${mode}):`);
  console.log(summarize(result.outcomes));
  // Build/lock must fail loudly on a required-skill failure.
  assertNoFatalOutcomes(result.outcomes);
  return true;
};
