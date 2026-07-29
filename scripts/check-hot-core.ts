import {
  isNativeScannerAvailable,
  LinearDfaScanner,
} from "../src/hotcore/index";

if (!isNativeScannerAvailable()) {
  throw new Error("Native hot-core addon did not load");
}

const scanner = new LinearDfaScanner(["secret", "ret", "💥é"]);
if (scanner.backend !== "native") {
  throw new Error("Scanner facade did not select the native hot core");
}

const EXPECTED_SECRET_END = 6;
const EXPECTED_UNICODE_END = 9;

const matches = [
  ...scanner.push("sec"),
  ...scanner.push("ret-💥"),
  ...scanner.push("é"),
];
const expected = [
  { pattern: "secret", endOffset: EXPECTED_SECRET_END },
  { pattern: "ret", endOffset: EXPECTED_SECRET_END },
  { pattern: "💥é", endOffset: EXPECTED_UNICODE_END },
];
if (JSON.stringify(matches) !== JSON.stringify(expected)) {
  throw new Error("Native hot-core scanner returned incompatible matches");
}

scanner.reset();
if (scanner.push("secret")[0]?.endOffset !== EXPECTED_SECRET_END) {
  throw new Error("Native hot-core scanner reset is incompatible");
}

console.log("Native hot-core scanner loaded and passed its smoke check");
