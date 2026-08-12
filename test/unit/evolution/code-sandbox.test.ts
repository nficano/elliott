import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  materializeFileEvolutionCodeSandbox,
} from "../../../src/learning/evolution/application/code-sandbox";

const sandboxRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "code-sandbox-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "main.ts"), "export const a = 1;\n");
  await writeFile(path.join(root, "src", "util.ts"), "export const b = 2;\n");
  await chmod(path.join(root, "src", "util.ts"), 0o755);
  return root;
};

const baseInput = (root: string) => ({
  componentRef: "core/code/demo",
  checkoutPaths: ["src/main.ts", "src/util.ts"],
  targetFiles: ["src/main.ts", "src/util.ts"],
  testCommands: [["bun", "test"]],
  cpuQuota: 1,
  memoryMb: 256,
  pids: 64,
  timeoutMilliseconds: 1000,
  resolveFile: (relative: string) => Effect.succeed(path.join(root, relative)),
});

describe("materializeFileEvolutionCodeSandbox", () => {
  it("materializes baseline files and marks executables", async () => {
    const root = await sandboxRoot();
    const result = await Effect.runPromise(
      materializeFileEvolutionCodeSandbox(baseInput(root)),
    );
    expect(result.baselineContent).toContain("src/main.ts");
    expect(
      result.codeSandbox.checkoutFiles.find((f) => f.path === "src/util.ts")
        ?.executable,
    ).toBe(true);
  });

  it("overlays active candidate files when they match targetFiles", async () => {
    const root = await sandboxRoot();
    const result = await Effect.runPromise(
      materializeFileEvolutionCodeSandbox({
        ...baseInput(root),
        activeContent: JSON.stringify({
          files: {
            "src/main.ts": "export const a = 9;\n",
            "src/util.ts": "export const b = 8;\n",
          },
        }),
      }),
    );
    expect(result.baselineContent).toContain("export const a = 9");
  });

  it("rejects bad active JSON and empty targetFiles", async () => {
    const root = await sandboxRoot();
    await expect(
      Effect.runPromise(materializeFileEvolutionCodeSandbox({
        ...baseInput(root),
        activeContent: "not-json",
      })),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(materializeFileEvolutionCodeSandbox({
        ...baseInput(root),
        activeContent: JSON.stringify({ files: { "src/main.ts": "x" } }),
      })),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(materializeFileEvolutionCodeSandbox({
        ...baseInput(root),
        targetFiles: [],
      })),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(materializeFileEvolutionCodeSandbox({
        ...baseInput(root),
        targetFiles: ["src/missing.ts"],
      })),
    ).rejects.toThrow();
  });
});
