import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonRecord } from "../../../src/providers/http";
import type { JsonRecord } from "../../../src/runtime/skills/types";
import type { EndpointRecord, EndpointStore, WebhookProfileId } from "./types";

const JSON_INDENT = 2;
const PROFILES: ReadonlySet<WebhookProfileId> = new Set([
  "hmac-sha256",
  "token-query",
  "slack-v2",
]);

// Endpoint records persist independently of the loader's grant store so the
// provisioner can re-mount verification routes for existing endpoints at
// register() time, before any consumer re-acquires.
export const endpointStore = (stateDirectory: string): EndpointStore => {
  const directory = path.join(stateDirectory, "webhook-provisioner");
  const file = path.join(directory, "endpoints.json");
  const load = async (): Promise<readonly EndpointRecord[]> =>
    decodeRecords(await readJson(file));
  const persist = async (records: readonly EndpointRecord[]): Promise<void> => {
    await mkdir(directory, { recursive: true });
    const draft = `${file}.tmp`;
    await writeFile(
      draft,
      JSON.stringify({ endpoints: records }, undefined, JSON_INDENT),
    );
    await rename(draft, file);
  };
  return {
    all: load,
    byName: async (consumer, name) =>
      (await load()).find(
        (item) => item.consumer === consumer && item.name === name,
      ),
    bySlug: async (slug) => (await load()).find((item) => item.slug === slug),
    save: async (record) => {
      const rest = (await load()).filter((item) => item.slug !== record.slug);
      await persist([...rest, record]);
    },
    remove: async (slug) => {
      await persist((await load()).filter((item) => item.slug !== slug));
    },
  };
};

const readJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

const decodeRecords = (value: unknown): readonly EndpointRecord[] => {
  if (!isJsonRecord(value) || !Array.isArray(value["endpoints"])) return [];
  return value["endpoints"].filter(isEndpointRecord);
};

const isEndpointRecord = (value: unknown): value is EndpointRecord =>
  isJsonRecord(value)
  && hasRequiredEndpointFields(value)
  && hasOptionalEndpointFields(value);

const hasRequiredEndpointFields = (value: JsonRecord): boolean =>
  typeof value["slug"] === "string"
  && typeof value["consumer"] === "string"
  && typeof value["name"] === "string"
  && PROFILES.has(value["profile"] as WebhookProfileId)
  && typeof value["maxBodyBytes"] === "number";

const hasOptionalEndpointFields = (value: JsonRecord): boolean =>
  (value["material"] === undefined || typeof value["material"] === "string")
  && (value["secretRef"] === undefined
    || typeof value["secretRef"] === "string")
  && (value["expiresAt"] === undefined
    || typeof value["expiresAt"] === "string");
