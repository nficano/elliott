import { describe, expect, it } from "bun:test";
import { digest } from "../../src/core/brands";
import {
  DiscoveryPipeline,
  runtimeContractDigest,
} from "../../src/core/discovery/discovery";
import { ValidationCache } from "../../src/core/discovery/validation-cache";
import { RuntimeContractMismatchError } from "../../src/core/errors";
import { ComponentSchemaRegistry } from "../../src/core/schema/schema";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { makeManifest, makeSchema, testProtocol } from "../helpers";

describe("G3 manifest/runtime contract", () => {
  it("keeps discovery import-free and quarantines a runtime divergence", async () => {
    const manifest = makeManifest("tool", "workspace/tool/g3", [], [
      testProtocol(),
    ]);
    const contract = {
      schema: manifest.schema,
      protocols: manifest.protocols,
      requestedCapabilities: manifest.requestedCapabilities,
    };
    let imports = 0;
    const records = new MemoryRecordAppender();
    const schemas = new ComponentSchemaRegistry();
    schemas.register(makeSchema());
    const pipeline = new DiscoveryPipeline(
      schemas,
      new ValidationCache(),
      {
        async load() {
          imports += 1;
          return {
            ...contract,
            requestedCapabilities: [{
              capability: "network.fetch",
              resources: ["https://example.com/**"],
            }],
          };
        },
      },
      records,
      "test-v1",
    );
    await pipeline.scan(
      [{
        root: "/test/g3",
        packageDigest: digest("package:g3"),
        manifest,
        moduleSpecifier: "./runtime.js",
        requestedIsolation: "process",
        schemaDigests: [manifest.schema.digest],
        provenanceTrustRoot: digest("trust:v1"),
        runtimeContractHash: runtimeContractDigest(contract),
      }],
      async () => undefined,
      async () => undefined,
    );
    expect(imports).toBe(0);
    await expect(pipeline.instantiate(manifest.ref)).rejects.toBeInstanceOf(
      RuntimeContractMismatchError,
    );
    expect(imports).toBe(1);
    expect(pipeline.resolve(manifest.ref)?.availability).toBe("unavailable");
    expect(
      records.list().some((record) => record.type === "component.quarantined"),
    ).toBe(true);
  });

  it("uses package validation cache but invalidates on consulted schema digest", async () => {
    const manifest = makeManifest();
    const contract = {
      schema: manifest.schema,
      protocols: manifest.protocols,
      requestedCapabilities: manifest.requestedCapabilities,
    };
    const schemas = new ComponentSchemaRegistry();
    schemas.register(makeSchema());
    const pipeline = new DiscoveryPipeline(
      schemas,
      new ValidationCache(),
      {
        async load() {
          return contract;
        },
      },
      new MemoryRecordAppender(),
      "test-v1",
    );
    const descriptor = {
      root: "/test/cache",
      packageDigest: digest("package:cache"),
      manifest,
      moduleSpecifier: "./runtime.js",
      requestedIsolation: makeSchema().minimumIsolation,
      schemaDigests: [manifest.schema.digest],
      provenanceTrustRoot: digest("trust:v1"),
      runtimeContractHash: runtimeContractDigest(contract),
    };
    let validations = 0;
    const validate = async (): Promise<void> => {
      validations += 1;
    };
    await pipeline.scan([descriptor], validate, async () => undefined);
    await pipeline.scan([descriptor], validate, async () => undefined);
    await pipeline.scan(
      [{ ...descriptor, schemaDigests: [digest("schema:consulted:v2")] }],
      validate,
      async () => undefined,
    );
    expect(validations).toBe(2);
    expect(pipeline.counters().cacheHits).toBe(1);
  });
});
