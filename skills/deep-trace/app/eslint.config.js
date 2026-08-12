// ESLint config for the telemetry-map Nuxt app.
//
// It mirrors every behavioral rule from the repo root eslint.config.js
// (complexity budgets, security, sonarjs, unicorn, magic numbers, restricted
// syntax) and borrows the Nuxt/Vue conventions from
// ~/code/tme/platform/tooling/eslint-config/src/nuxt.js (vue flat/recommended,
// alphabetical attributes, block order, self-closing, PascalCase usage,
// auto-import globals, filename cases, storybook). Type-aware rules and the
// dprint formatter are root-repo concerns that do not apply to .vue sources.
import js from "@eslint/js";
import perfectionist from "eslint-plugin-perfectionist";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import storybook from "eslint-plugin-storybook";
import unicorn from "eslint-plugin-unicorn";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

const processEnvRestriction = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "Direct process.env access is forbidden. Read configuration through runtime config.",
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

// Nuxt auto-imported globals (subset actually used by this app).
const nuxtAutoImportGlobals = Object.fromEntries(
  [
    "computed",
    "defineNuxtConfig",
    "defineAppConfig",
    "defineNuxtPlugin",
    "navigateTo",
    "nextTick",
    "onBeforeUnmount",
    "onMounted",
    "onUnmounted",
    "reactive",
    "readonly",
    "ref",
    "shallowRef",
    "toRef",
    "toRefs",
    "useAppConfig",
    "useAsyncData",
    "useFetch",
    "useHead",
    "useNuxtApp",
    "useRoute",
    "useRouter",
    "useRuntimeConfig",
    "useSlots",
    "useState",
    "watch",
    "watchEffect",
  ].map((name) => [name, "readonly"]),
);

const elliottRuleMirror = {
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
  "max-params": ["error", 3],
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
  // Same opt-outs as the root config, same rationale.
  "unicorn/prevent-abbreviations": "off",
  "unicorn/no-null": "off",
  "sonarjs/no-nested-functions": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/prefer-ternary": "off",
  "unicorn/no-array-reduce": "off",
  "unicorn/no-array-callback-reference": "off",
  "unicorn/prefer-math-trunc": "off",
  "unicorn/prefer-code-point": "off",
  "unicorn/no-array-sort": "off",
  "unicorn/prefer-spread": "off",
  "sonarjs/use-type-alias": "off",
  "sonarjs/regex-complexity": "off",
  "sonarjs/void-use": "off",
};

const vueRules = {
  "vue/max-attributes-per-line": "off",
  "vue/attributes-order": ["error", { alphabetical: true }],
  "vue/multi-word-component-names": "off",
  "vue/block-order": ["error", { order: ["template", "script", "style"] }],
  "vue/html-self-closing": [
    "error",
    {
      html: { void: "always", normal: "always", component: "always" },
      svg: "always",
      math: "always",
    },
  ],
  "vue/first-attribute-linebreak": [
    "error",
    { singleline: "ignore", multiline: "below" },
  ],
  "vue/component-name-in-template-casing": [
    "error",
    "PascalCase",
    { registeredComponentsOnly: false, ignores: [] },
  ],
};

export default [
  {
    ignores: [
      "node_modules/**",
      ".nuxt/**",
      ".output/**",
      "dist/**",
      "storybook-static/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  unicorn.configs.recommended,
  sonarjs.configs.recommended,
  ...storybook.configs["flat/recommended"],
  {
    plugins: { perfectionist, security },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...nuxtAutoImportGlobals,
      },
    },
    rules: {
      ...elliottRuleMirror,
      "perfectionist/sort-imports": [
        "error",
        {
          groups: [
            "type",
            ["builtin", "external"],
            "internal-type",
            "internal",
            ["parent-type", "sibling-type", "index-type"],
            ["parent", "sibling", "index"],
            "object",
            "unknown",
          ],
          newlinesBetween: "always",
          type: "natural",
          order: "asc",
          ignoreCase: false,
        },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      ...vueRules,
      // Component templates legitimately exceed the source-module budget.
      "max-lines": ["error", {
        max: 400,
        skipBlankLines: true,
        skipComments: true,
      }],
    },
  },
  {
    files: ["app/components/**/*.vue"],
    rules: {
      "unicorn/filename-case": ["error", { case: "pascalCase" }],
    },
  },
  {
    files: ["app/composables/**/*.ts"],
    rules: {
      "unicorn/filename-case": ["error", { case: "camelCase" }],
    },
  },
  {
    files: ["app/pages/**/*.vue", "app/layouts/**/*.vue"],
    rules: {
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
    },
  },
  {
    // shared/ is a fidelity port of the legacy canvas renderer and pack
    // builder. Painters are long imperative sequences whose draw order the
    // port must preserve; numeric literals are the medium of geometry; the
    // flagged regexes run only over the verified topology document (short,
    // trusted strings). Correctness and security rules remain in force.
    files: ["shared/**/*.ts"],
    rules: {
      "no-magic-numbers": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "max-params": "off",
      "complexity": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-nested-conditional": "off",
      "unicorn/no-nested-ternary": "off",
      "sonarjs/slow-regex": "off",
    },
  },
  {
    // The config file itself declares threshold literals (same carve-out as
    // the repo root eslint.config.js).
    files: ["eslint.config.js"],
    rules: {
      "no-magic-numbers": "off",
      "max-lines": "off",
    },
  },
  {
    files: [
      "**/*.vitest.ts",
      "**/*.stories.ts",
      "e2e/**/*.ts",
      "playwright.config.ts",
      "vitest.config.ts",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "no-magic-numbers": "off",
      "no-restricted-syntax": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      complexity: "off",
    },
  },
];
