/* eslint-disable no-magic-numbers */
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../../../runtime/wire";

const ARGUMENT_COUNT = 2;
const [requestPath, resultPath] = Bun.argv.slice(2);
if (
  Bun.argv.slice(2).length !== ARGUMENT_COUNT
  || requestPath === undefined
  || resultPath === undefined
) {
  process.exit(64);
}

const value: unknown = JSON.parse(await readFile(requestPath, "utf8"));
if (value === null || typeof value !== "object" || Array.isArray(value)) {
  throw new TypeError("request must be an object");
}
const PRIVATE_FILE_MODE = 0o600;
const WORK_MILLISECONDS = 200;
await Bun.sleep(WORK_MILLISECONDS);
const temporary = resultPath.slice(0, -path.extname(resultPath).length)
  + ".tmp";
await writeFile(
  temporary,
  canonicalJson({
    candidates: [],
  }),
);
await chmod(temporary, PRIVATE_FILE_MODE);
await rename(temporary, resultPath);
