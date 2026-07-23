import { describe, expect, test } from "bun:test";
import {
  orderMigrationFiles,
  parseMigrationFilename,
  planCompatibilityBridge,
} from "../src/store/migrate.js";

const sentinels = [true, true, true, true, true, true, true];

describe("Effect SQL migration discovery", () => {
  test("parses only numbered SQL migration filenames", () => {
    expect(parseMigrationFilename("0001_init.sql")).toEqual({
      file: "0001_init.sql",
      id: 1,
      name: "init",
      version: "0001_init",
    });
    expect(parseMigrationFilename("init.sql")).toBeUndefined();
    expect(parseMigrationFilename("0002_more.ts")).toBeUndefined();
    expect(parseMigrationFilename("0_invalid.sql")).toBeUndefined();
  });

  test("orders valid migrations numerically", () => {
    expect(
      orderMigrationFiles([
        "0010_tenth.sql",
        "README.md",
        "0002_second.sql",
        "0001_init.sql",
      ]).map((migration) => migration.version),
    ).toEqual(["0001_init", "0002_second", "0010_tenth"]);
  });
});

describe("legacy migration compatibility bridge", () => {
  test("runs baseline on a genuinely fresh database", () => {
    expect(planCompatibilityBridge({
      legacyVersions: [],
      effectMigrations: [],
      baselineSentinels: sentinels.map(() => false),
    })).toEqual({ _tag: "Fresh" });
  });

  test("seeds Effect ledger for a validated legacy baseline", () => {
    expect(planCompatibilityBridge({
      legacyVersions: ["0001_init"],
      effectMigrations: [],
      baselineSentinels: sentinels,
    })).toEqual({ _tag: "SeedEffectBaseline" });
  });

  test("accepts matching dual ledgers", () => {
    expect(planCompatibilityBridge({
      legacyVersions: ["0001_init"],
      effectMigrations: [{ id: 1, name: "init" }],
      baselineSentinels: sentinels,
    })).toEqual({ _tag: "Ready" });
  });

  test("accepts later migrations only when both ledgers agree", () => {
    const known = [
      { id: 1, name: "init", version: "0001_init" },
      { id: 2, name: "next", version: "0002_next" },
    ];
    expect(planCompatibilityBridge({
      legacyVersions: ["0001_init", "0002_next"],
      effectMigrations: [{ id: 1, name: "init" }, { id: 2, name: "next" }],
      baselineSentinels: sentinels,
    }, known)).toEqual({ _tag: "Ready" });
    expect(
      planCompatibilityBridge({
        legacyVersions: ["0001_init"],
        effectMigrations: [{ id: 1, name: "init" }, { id: 2, name: "next" }],
        baselineSentinels: sentinels,
      }, known)._tag,
    ).toBe("Invalid");
  });

  test("rejects a missing migration below the applied maximum", () => {
    const known = [
      { id: 1, name: "init", version: "0001_init" },
      { id: 2, name: "second", version: "0002_second" },
      { id: 3, name: "third", version: "0003_third" },
    ];
    const plan = planCompatibilityBridge({
      legacyVersions: ["0001_init", "0003_third"],
      effectMigrations: [
        { id: 1, name: "init" },
        { id: 3, name: "third" },
      ],
      baselineSentinels: sentinels,
    }, known);

    expect(plan).toEqual({
      _tag: "Invalid",
      message: "Effect migration ledger is missing an earlier migration",
    });
  });

  test("fails closed on partial schema or one-sided Effect ledger", () => {
    expect(
      planCompatibilityBridge({
        legacyVersions: [],
        effectMigrations: [],
        baselineSentinels: [true, false, false, false, false, false, false],
      })._tag,
    ).toBe("Invalid");
    expect(
      planCompatibilityBridge({
        legacyVersions: [],
        effectMigrations: [{ id: 1, name: "init" }],
        baselineSentinels: sentinels,
      })._tag,
    ).toBe("Invalid");
  });

  test("fails closed on mismatched or unknown ledger entries", () => {
    expect(
      planCompatibilityBridge({
        legacyVersions: ["0001_other"],
        effectMigrations: [],
        baselineSentinels: sentinels,
      })._tag,
    ).toBe("Invalid");
    expect(
      planCompatibilityBridge({
        legacyVersions: ["0001_init"],
        effectMigrations: [{ id: 1, name: "wrong" }],
        baselineSentinels: sentinels,
      })._tag,
    ).toBe("Invalid");
  });
});
