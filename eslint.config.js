import effect from "@effect/eslint-plugin";
import effectDisableConflicts from "@effect/eslint-plugin/configs/disable-conflict-rules";
import js from "@eslint/js";
import betterMaxParams from "eslint-plugin-better-max-params";
import importX from "eslint-plugin-import-x";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";
import local from "./eslint-rules/index.js";

// dprint typescript config — 2-space / double-quote / semicolon style. The
// ESLint `@effect/dprint` rule formats via the bundled @dprint/typescript
// engine; the `dprint` CLI (format scripts) reads dprint.json with the same
// values.
const dprintConfig = {
  indentWidth: 2,
  lineWidth: 80,
  semiColons: "always",
  quoteStyle: "alwaysDouble",
  trailingCommas: "onlyMultiLine",
};

const processEnvRestriction = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "Direct process.env access is forbidden. Read configuration through the runtime config boundary.",
};

const timeValueRestriction = {
  selector:
    "Property[key.name=/^(.*Ms|.*_ms|timeout|delay|interval|duration|ttl)$/] > Literal.value",
  message: "Time values require a named constant with units.",
};

const securityRules = {
  "security/detect-buffer-noassert": "error",
  "security/detect-child-process": "error",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-eval-with-expression": "error",
  "security/detect-new-buffer": "error",
  "security/detect-no-csrf-before-method-override": "error",
  "security/detect-non-literal-require": "error",
  "security/detect-pseudoRandomBytes": "error",
  "security/detect-unsafe-regex": "error",
  "security/detect-bidi-characters": "error",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      ".repos/**",
      "crates/hot-core/target/**",
    ],
  }, // node_modules is ignored by default
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked, // type-aware rules
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  // Turn off every core stylistic rule that would fight dprint (the plugin's
  // own preset). This is the "remove conflicting rules" pass on formatting.
  ...effectDisableConflicts,
  {
    plugins: {
      "better-max-params": betterMaxParams,
      "import-x": importX,
      security,
      "@effect": effect,
      local,
    },
    languageOptions: {
      parserOptions: {
        // Type-aware linting; allowDefaultProject lets this config file (which
        // no tsconfig includes) resolve via the default project.
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "eslint-rules/*.js",
            "scripts/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // complexity
      complexity: ["error", 10],
      "max-depth": ["error", 4],
      "max-lines": ["error", {
        max: 250,
        skipBlankLines: true,
        skipComments: true,
      }],
      "max-lines-per-function": ["error", {
        max: 50,
        skipBlankLines: true,
        skipComments: true,
      }],
      "max-statements": ["error", 20],
      "max-params": "off",
      "better-max-params/better-max-params": ["error", {
        constructor: 10,
        func: 3,
      }],
      "sonarjs/cognitive-complexity": ["error", 15],
      "no-magic-numbers": ["error", {
        detectObjects: false,
        enforceConst: true,
        ignore: [-1, 0, 1, 2],
        ignoreArrayIndexes: true,
      }],
      eqeqeq: ["error", "always"],
      "no-restricted-syntax": [
        "error",
        processEnvRestriction,
        timeValueRestriction,
      ],
      ...securityRules,

      // import hygiene. NOTE: `import-x/order`'s autofixer conflicts
      // destructively with the dprint fixer under editor fix-all-on-save (it
      // duplicated/dropped imports) — left off so the two formatters don't
      // race. `no-cycle` is not autofixable and stays on.
      "import-x/order": "off",
      "import-x/no-cycle": "error",

      // Effect: import the specific module, not the `effect` barrel — better
      // tree-shaking and the idiomatic `import * as Effect from "effect/Effect"`.
      "@effect/no-import-from-barrel-package": ["error", {
        packageNames: ["effect"],
      }],

      // dprint owns formatting.
      "@effect/dprint": ["error", { config: dprintConfig }],

      // Idiomatic short names (ctx, err, ref, cfg) and null interop; unicorn's
      // rename/no-null opinions conflict with that — removed.
      "unicorn/name-replacements": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      // Functional schema code is intentionally call- and closure-heavy; these
      // style rules obscure the declarative structure instead of helping.
      "sonarjs/no-nested-functions": "off",
      "unicorn/max-nested-calls": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-this-outside-of-class": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/no-computed-property-existence-check": "off",
      "unicorn/no-duplicate-loops": "off",
      "unicorn/no-unreadable-for-of-expression": "off",
      "unicorn/prefer-simple-condition-first": "off",
      "unicorn/prefer-spread": "off",
      "unicorn/prefer-iterator-helpers": "off",
      "unicorn/prefer-iterator-to-array": "off",
      // Interface implementations often need Promise-returning methods even
      // when a particular implementation completes synchronously.
      "@typescript-eslint/require-await": "off",
      // These are naming/ordering opinions, not correctness checks.
      "unicorn/consistent-boolean-name": "off",
      "unicorn/consistent-class-member-order": "off",
      "unicorn/no-non-function-verb-prefix": "off",
      "unicorn/prefer-includes-over-repeated-comparisons": "off",
      "unicorn/prefer-ternary": "off",
      // Explicit promise chains and callbacks are clearer in several adapters.
      "unicorn/no-array-callback-reference": "off",
      "unicorn/prefer-await": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/no-return-array-push": "off",
      // In-place sorting and UTF-16/bitwise operations are intentional in hot
      // paths and remain compatible with older JavaScript runtimes.
      "unicorn/no-array-sort": "off",
      "unicorn/prefer-code-point": "off",
      "unicorn/prefer-math-trunc": "off",
      // This is a style preference with no effect on the resulting type.
      "sonarjs/use-type-alias": "off",
      "sonarjs/regex-complexity": "off",
      // Fire-and-forget calls deliberately discard their promises.
      "sonarjs/void-use": "off",
      // The flagged exits are in executable entry points.
      "unicorn/no-process-exit": "off",
      // reduce is appropriate for immutable accumulator construction.
      "unicorn/no-array-reduce": "off",
      // The TypeScript ESLint API still exposes this compatibility API.
      "sonarjs/deprecation": "off",
      // Its autofix rewrites `() => undefined` to a void `() => {}`, which
      // changes a value-returning callback's type — disabled to keep
      // fix-on-save safe.
      "unicorn/no-useless-undefined": "off",
    },
  },
  {
    files: ["src/**/*.ts", "skills/**/*.ts"],
    rules: {
      "local/no-mixed-schema-types": "error",
      "local/no-types-outside-type-modules": "error",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "local/no-types-outside-type-modules": "error",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["eslint-rules/**/*.js"],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      complexity: "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
  {
    files: ["eslint.config.js"],
    rules: {
      "no-magic-numbers": "off",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // Mocks intentionally use partial and dynamically shaped values.
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "better-max-params/better-max-params": "off",
      complexity: "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "no-magic-numbers": "off",
      "no-restricted-syntax": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/prefer-specific-assertions": "off",
    },
  },
);
