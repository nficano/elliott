import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifest = path.join(
  repositoryRoot,
  "crates",
  "hot-core",
  "Cargo.toml",
);
const releaseDirectory = path.join(
  repositoryRoot,
  "crates",
  "hot-core",
  "target",
  "release",
);
const nativeDirectory = path.join(repositoryRoot, "native");
const output = path.join(nativeDirectory, "elliott-hot-core.node");

const libraryName = (): string => {
  switch (process.platform) {
    case "darwin": {
      return "libelliott_hot_core_napi.dylib";
    }
    case "linux": {
      return "libelliott_hot_core_napi.so";
    }
    case "win32": {
      return "elliott_hot_core_napi.dll";
    }
    default: {
      throw new Error(
        `Unsupported native hot-core platform: ${process.platform}`,
      );
    }
  }
};

const build = Bun.spawn([
  "cargo",
  "build",
  "--release",
  "--locked",
  "--manifest-path",
  manifest,
  "-p",
  "elliott-hot-core-napi",
], {
  cwd: repositoryRoot,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await build.exited;
if (exitCode !== 0) {
  throw new Error(`Native hot-core build failed with exit code ${exitCode}`);
}

await mkdir(nativeDirectory, { recursive: true });
await copyFile(path.join(releaseDirectory, libraryName()), output);
console.log(`Built native hot core: ${output}`);
