import { describe, expect, it } from "bun:test";
import path from "node:path";

// A boot that fails on configuration is the first thing a new operator sees. An
// uncaught throw from the entrypoint prints a Bun stack dump with source
// excerpts around the throwing line; `elliott doctor` renders the identical
// fault as one line naming the field. This pins the two to the same standard.
//
// Spawns the real entrypoint rather than calling a helper, because the defect
// this guards lives in the process's top-level error handling, which is exactly
// what a unit-level call would bypass.

const REPO_ROOT = path.join(import.meta.dir, "..", "..");
const BOOT_TIMEOUT_MS = 60_000;

const bootWith = async (
  env: Readonly<Record<string, string>>,
): Promise<{ readonly code: number; readonly stderr: string; }> => {
  const proc = Bun.spawn(["bun", "src/runtime/main.ts"], {
    cwd: REPO_ROOT,
    // A bare environment: inheriting the developer's shell would let an
    // ambient ELLIOTT_LLM_MODEL satisfy the very variable under test.
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stderr };
};

describe("runtime entrypoint configuration failure", () => {
  it(
    "names the missing variable on one line, with no stack trace",
    async () => {
      const { code, stderr } = await bootWith({
        ELLIOTT_LLM_PROVIDER: "anthropic",
        ELLIOTT_LLM_API_KEY: "sk-not-a-real-key",
        // ELLIOTT_LLM_MODEL deliberately absent.
      });

      expect(code).toBe(1);
      expect(stderr).toContain("Environment is missing ELLIOTT_LLM_MODEL");

      // The actionable line is prefixed and self-contained.
      const reported = stderr.split("\n").find((line) =>
        line.includes("Environment is missing")
      );
      expect(reported).toBeDefined();
      expect(reported).toContain("elliott:");

      // No stack frames, and no source excerpt. `at <fn> (/path/file.ts:12:3)`
      // is the shape Bun prints; the caret line is the code-frame marker. Both
      // are what this fix removed, and either returning is the regression.
      // Literal spaces rather than `\s+…\S+…\s+`: the latter backtracks
      // super-linearly on a long non-matching line, which the lint rule rejects.
      expect(stderr).not.toMatch(/\n {2,}at /);
      expect(stderr).not.toContain("^");
      expect(stderr).not.toContain("src/runtime/config.ts:");
    },
    BOOT_TIMEOUT_MS,
  );
});
