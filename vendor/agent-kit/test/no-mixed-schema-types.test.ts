import { describe, expect, test } from "bun:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import local from "../eslint-rules/index.js";

const lint = (code: string) =>
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
      rules: { "local/no-mixed-schema-types": "error" },
    },
    { filename: "fixture.ts" },
  );

describe("local/no-mixed-schema-types", () => {
  test("accepts separated type and schema files", () => {
    expect(
      lint(`
        import * as Schema from "effect/Schema";
        export interface Input { readonly value: string }
        export type Decoder = Schema.Decoder<Input>;
      `),
    ).toHaveLength(0);

    expect(
      lint(`
        import * as Schema from "effect/Schema";
        export const Input = Schema.Struct({ value: Schema.String });
      `),
    ).toHaveLength(0);
  });

  test("reports every type declaration in a mixed file", () => {
    const messages = lint(`
      import * as Schema from "effect/Schema";
      interface Input { readonly value: string }
      export type Output = { readonly value: string };
      export const InputSchema = Schema.Struct({ value: Schema.String });
    `);

    expect(messages.map(({ ruleId }) => ruleId)).toEqual([
      "local/no-mixed-schema-types",
      "local/no-mixed-schema-types",
    ]);
    expect(messages.every(({ message }) => message.includes("types file")))
      .toBe(
        true,
      );
  });

  test("recognizes an aliased Schema namespace import", () => {
    expect(
      lint(`
        import * as RuntimeSchema from "effect/Schema";
        type Identifier = string;
        const IdentifierSchema = RuntimeSchema.String;
        const Transformation = RuntimeSchema.decodeTo(RuntimeSchema.String);
      `),
    ).toHaveLength(1);
  });

  test("recognizes schema class declarations", () => {
    expect(
      lint(`
        import * as S from "effect/Schema";
        interface Fields { readonly value: string }
        class Payload extends S.Class<Payload>("Payload")({
          value: S.String,
        }) {}
      `),
    ).toHaveLength(1);

    expect(
      lint(`
        import * as S from "effect/Schema";
        type EventName = string;
        class Event extends S.TaggedClass<Event>()("Event", {
          name: S.String,
        }) {}
      `),
    ).toHaveLength(1);

    expect(
      lint(`
        import * as S from "effect/Schema";
        interface FailureFields { readonly cause: string }
        class Failure extends S.ErrorClass<Failure>("Failure")({
          cause: S.String,
        }) {}
      `),
    ).toHaveLength(1);

    expect(
      lint(`
        import * as S from "effect/Schema";
        type Cause = string;
        class Failure extends S.TaggedErrorClass<Failure>()("Failure", {
          cause: S.String,
        }) {}
      `),
    ).toHaveLength(1);
  });

  test("reports schema-derived typeof aliases declared beside schemas", () => {
    expect(
      lint(`
        import * as Schema from "effect/Schema";
        export const Payload = Schema.Struct({ value: Schema.String });
        export type Payload = typeof Payload.Type;
      `),
    ).toHaveLength(1);
  });

  test("does not classify decoder and encoder utilities as schemas", () => {
    expect(
      lint(`
        import * as Schema from "effect/Schema";
        interface Input { readonly value: string }
        const decode = Schema.decodeUnknownEffect(Schema.String);
        const decodeKnown = Schema.decodeResult(Schema.String);
        const encode = Schema.encodeUnknownSync(Schema.String);
        const encodeKnown = Schema.encodePromise(Schema.String);
        const json = Schema.toJsonSchemaDocument(Schema.String);
        const standard = Schema.toStandardSchemaV1(Schema.String);
        const acceptsDecoder = (
          decoder: Schema.Decoder<string>,
        ): Schema.Decoder<string> => decoder;
      `),
    ).toHaveLength(0);
  });
});
