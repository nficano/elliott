import { describe, expect, test } from "bun:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import local from "../eslint-rules/index.js";

const ruleId = "local/no-types-outside-type-modules";

const lint = (code: string, filename = "src/fixture.ts") =>
  new Linter().verify(
    code,
    {
      files: ["**/*.ts"],
      languageOptions: {
        ecmaVersion: "latest",
        parser: tseslint.parser,
        sourceType: "module",
      },
      plugins: { local },
      rules: { [ruleId]: "error" },
    },
    { filename },
  );

describe(ruleId, () => {
  test("reports every prohibited top-level declaration", () => {
    const messages = lint(`
      interface Input { readonly value: string }
      type Output = { readonly value: string };
      enum Status { Ready }
      namespace Protocol {}
    `);

    expect(messages.map(({ ruleId: reportedRuleId }) => reportedRuleId))
      .toEqual([
        ruleId,
        ruleId,
        ruleId,
        ruleId,
      ]);
    expect(messages.map(({ line }) => line)).toEqual([2, 3, 4, 5]);
    expect(messages.every(({ severity }) => severity === 2)).toBe(true);
  });

  test("reports exported and ambient declarations", () => {
    const messages = lint(`
      export interface Input {}
      export type Output = string;
      export enum Status { Ready }
      export namespace Protocol {}
      export default interface DefaultInput {}
      declare module "external-package" {}
      declare global {}
    `);

    expect(messages).toHaveLength(7);
    expect(
      messages.every(({ ruleId: reportedRuleId }) => reportedRuleId === ruleId),
    ).toBe(true);
  });

  test("allows declarations in every dedicated type filename", () => {
    const filenames = [
      "src/types.ts",
      "src/domain.d.ts",
      String.raw`C:\repo\src\types.ts`,
    ];

    for (const filename of filenames) {
      expect(lint("export interface Allowed {}", filename)).toHaveLength(0);
    }
  });

  test("does not exempt similar ordinary filenames", () => {
    const filenames = [
      "src/type.ts",
      "src/types-helper.ts",
      "src/domain.types.ts",
      "src/domain-types.ts",
      "src/host/registry/index-types.ts",
      "src/domain.types-helper.ts",
      "src/domain-types.generated.ts",
    ];

    for (const filename of filenames) {
      expect(lint("type Disallowed = string;", filename)).toHaveLength(1);
    }
  });

  test("reports nested type declarations", () => {
    const messages = lint(`
      function build() {
        interface LocalInput {}
        type LocalOutput = string;
        enum LocalStatus { Ready }
        return LocalStatus.Ready;
      }
    `);

    expect(messages.map(({ ruleId: reportedRuleId }) => reportedRuleId))
      .toEqual([ruleId, ruleId, ruleId]);
  });

  test("ignores top-level declarations outside the prohibited set", () => {
    expect(
      lint(`
        import type { External } from "./external.js";
        export class Service {}
        export function identity<T>(value: T): T { return value; }
        export const value: External | undefined = undefined;
      `),
    ).toHaveLength(0);
  });
});
