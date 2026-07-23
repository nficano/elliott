import { createHash, randomUUID } from "node:crypto";
import { digest } from "./brands";
import type { Digest } from "./types";

export const hashBytes = (input: string | Uint8Array): Digest =>
  digest(`sha256:${createHash("sha256").update(input).digest("hex")}`);

export const hashValue = (value: unknown): Digest =>
  hashBytes(JSON.stringify(value));

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;
