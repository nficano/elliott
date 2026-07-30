import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonRecord } from "../../providers/http";
import { assertMatchesSchema } from "./schema";
import type {
  FacilityBinding,
  FacilityDescriptor,
  FacilityDirectory,
  FacilityGrant,
  JsonRecord,
  RegisteredFacility,
  StoredGrant,
} from "./types";

// The runtime-wide facility directory: providers register FacilityBindings
// during loader pass 1; consumers acquire grants through a per-package scoped
// view during pass 2. Grants persist under
// <stateDirectory>/facilities/grants.json so the public URL a consumer
// registered with an external sender survives reboots: acquire is idempotent
// on (consumer, name) and a repeat call with unchanged config returns the
// stored grant without re-invoking the provider. See docs/explanation/skill-facilities.md.

const GRANTS_FILE = "grants.json";
const JSON_INDENT = 2;

export class RuntimeFacilityDirectory {
  readonly #directory: string;
  readonly #facilities = new Map<string, RegisteredFacility>();
  #grants: Map<string, StoredGrant> | undefined;

  constructor(stateDirectory: string) {
    this.#directory = path.join(stateDirectory, "facilities");
  }

  register(provider: string, binding: FacilityBinding): void {
    const existing = this.#facilities.get(binding.id);
    if (existing !== undefined) {
      throw new Error(
        `Facility ${binding.id} is provided by both ${existing.provider} `
          + `and ${provider}`,
      );
    }
    this.#facilities.set(binding.id, { provider, binding });
  }

  list(): readonly FacilityDescriptor[] {
    return [...this.#facilities.values()]
      .map((item) => item.binding.describe());
  }

  describe(id: string): FacilityDescriptor | undefined {
    return this.#facilities.get(id)?.binding.describe();
  }

  // The consumer-facing view the loader places on SkillContext. The consumer
  // string is stamped here from the package manifest, never caller input.
  scoped(consumer: string): FacilityDirectory {
    return {
      list: () => this.list(),
      describe: (id) => this.describe(id),
      acquire: (id, name, config) =>
        this.#acquire({ consumer, id, name, config }),
      release: (grantId) => this.#release(consumer, grantId),
    };
  }

  // Providers register before consumers and may not themselves acquire —
  // the two-pass loader has no directory to satisfy a pass-1 acquire, so a
  // provider that tries gets a hard error instead of a cycle.
  providerView(): FacilityDirectory {
    return {
      list: () => this.list(),
      describe: (id) => this.describe(id),
      acquire: (id) =>
        Promise.reject(
          new Error(
            `Facility providers may not acquire facilities (requested ${id})`,
          ),
        ),
      release: () =>
        Promise.reject(new Error("Facility providers may not release grants")),
    };
  }

  async #acquire(input: {
    readonly consumer: string;
    readonly id: string;
    readonly name: string;
    readonly config: JsonRecord;
  }): Promise<FacilityGrant> {
    const registered = this.#facilities.get(input.id);
    if (registered === undefined) {
      throw new Error(`No skill provides the facility ${input.id}`);
    }
    const { binding } = registered;
    const descriptor = binding.describe();
    assertMatchesSchema(
      input.config,
      descriptor.requestSchema,
      `facility ${input.id} request`,
    );
    const grants = await this.#loadGrants();
    const key = grantKey(input.consumer, input.id, input.name);
    const stored = grants.get(key);
    if (stored !== undefined && sameGrantSource(stored, input, binding)) {
      return stored.grant;
    }
    const grant = await binding.acquire({
      consumer: input.consumer,
      name: input.name,
      config: input.config,
    });
    assertMatchesSchema(
      grant.values,
      descriptor.grantSchema,
      `facility ${input.id} grant`,
    );
    grants.set(key, {
      consumer: input.consumer,
      name: input.name,
      facilityId: input.id,
      version: binding.version,
      config: input.config,
      grant,
    });
    await this.#saveGrants(grants);
    return grant;
  }

  async #release(consumer: string, grantId: string): Promise<void> {
    const grants = await this.#loadGrants();
    const entry = [...grants].find(([, stored]) =>
      stored.consumer === consumer && stored.grant.grantId === grantId
    );
    if (entry === undefined) {
      throw new Error(`${consumer} holds no grant ${grantId}`);
    }
    const [key, stored] = entry;
    await this.#facilities.get(stored.facilityId)?.binding.release?.(grantId);
    grants.delete(key);
    await this.#saveGrants(grants);
  }

  async #loadGrants(): Promise<Map<string, StoredGrant>> {
    if (this.#grants !== undefined) return this.#grants;
    this.#grants = new Map(
      decodeGrants(await readGrantsFile(this.#grantsPath()))
        .map((item) => [
          grantKey(item.consumer, item.facilityId, item.name),
          item,
        ]),
    );
    return this.#grants;
  }

  async #saveGrants(grants: Map<string, StoredGrant>): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const file = this.#grantsPath();
    const draft = `${file}.tmp`;
    await writeFile(
      draft,
      JSON.stringify({ grants: [...grants.values()] }, undefined, JSON_INDENT),
    );
    await rename(draft, file);
  }

  #grantsPath(): string {
    return path.join(this.#directory, GRANTS_FILE);
  }
}

// A repeat acquire only reuses the stored grant when nothing that produced it
// changed: same facility, same contract version, and byte-identical config.
// Any drift re-invokes the provider, which must be idempotent per
// (consumer, name) so stable resources (slugs, URLs) survive the re-acquire.
const sameGrantSource = (
  stored: StoredGrant,
  input: { readonly id: string; readonly config: JsonRecord; },
  binding: FacilityBinding,
): boolean =>
  stored.facilityId === input.id
  && stored.version === binding.version
  && stableStringify(stored.config) === stableStringify(input.config);

// A consumer may reuse the same handle across different facilities (e.g.
// "public" on both proxy.route and dns.local), so the store keys on all
// three coordinates; idempotency stays per (consumer, name) within a
// facility, which is what the contract promises.
const grantKey = (consumer: string, facilityId: string, name: string): string =>
  `${consumer}::${facilityId}::${name}`;

const readGrantsFile = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

// Read-only view of the persisted grants for observers (the telemetry map
// derives consumer->provider edges from it). Same file and decoding as the
// directory itself; missing or malformed files read as no grants.
export const readStoredGrants = async (
  stateDirectory: string,
): Promise<readonly StoredGrant[]> =>
  decodeGrants(
    await readGrantsFile(
      path.join(stateDirectory, "facilities", GRANTS_FILE),
    ),
  );

const decodeGrants = (value: unknown): readonly StoredGrant[] => {
  if (!isJsonRecord(value) || !Array.isArray(value["grants"])) return [];
  return value["grants"].filter(isStoredGrant);
};

const isStoredGrant = (value: unknown): value is StoredGrant =>
  isJsonRecord(value)
  && typeof value["consumer"] === "string"
  && typeof value["name"] === "string"
  && typeof value["facilityId"] === "string"
  && typeof value["version"] === "number"
  && isJsonRecord(value["config"])
  && isJsonRecord(value["grant"])
  && typeof value["grant"]["grantId"] === "string"
  && typeof value["grant"]["facility"] === "string"
  && isJsonRecord(value["grant"]["values"]);

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (!isJsonRecord(value)) return JSON.stringify(value) ?? "undefined";
  const body = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",");
  return `{${body}}`;
};

// For harnesses and tests that build a SkillContext directly, outside the
// loader: a directory with nothing registered, so any acquire fails the same
// way a missing provider does in production.
export const standaloneFacilityDirectory = (): FacilityDirectory => {
  const directory = new RuntimeFacilityDirectory(".");
  return directory.scoped("standalone");
};
