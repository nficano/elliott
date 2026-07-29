const TYPE_DECLARATION_TYPES = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);

const getBasename = (filename) => {
  const normalized = filename.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

const isTypeModule = (filename) => {
  const basename = getBasename(filename);
  return basename === "types.ts"
    || basename.endsWith(".d.ts");
};

const create = (context) => {
  if (isTypeModule(context.filename)) return {};
  const report = (node) => {
    context.report({
      node,
      messageId: "declarationOutsideTypeModule",
    });
  };
  return Object.fromEntries(
    [...TYPE_DECLARATION_TYPES].map((nodeType) => [nodeType, report]),
  );
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require named TypeScript declarations to live in dedicated type modules.",
    },
    messages: {
      declarationOutsideTypeModule:
        "Move this TypeScript declaration to a dedicated type module.",
    },
    schema: [],
  },
  create,
};
