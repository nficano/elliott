const SCHEMA_CLASS_BUILDERS = new Set([
  "Class",
  "ErrorClass",
  "TaggedClass",
  "TaggedErrorClass",
]);

const NON_SCHEMA_PREFIXES = [
  "is",
  "toArbitrary",
  "toCodec",
  "toDiffer",
  "toEncoder",
  "toEquivalence",
  "toFormatter",
  "toIso",
  "toJsonSchema",
  "toRepresentation",
  "toStandard",
];

const NON_SCHEMA_MEMBERS = new Set([
  "Decoder",
  "Encoder",
  "isSchema",
]);

const CODEC_OPERATION =
  /^(?:decode|encode)(?:Unknown)?(?:Effect|Exit|Option|Promise|Result|Sync)$/;

const getMemberName = (node) => {
  if (node.computed && node.property.type === "Literal") {
    return typeof node.property.value === "string"
      ? node.property.value
      : undefined;
  }
  return node.computed ? undefined : node.property.name;
};

const getSchemaMember = (node, schemaNamespaces) => {
  if (node?.type !== "MemberExpression") return undefined;
  if (node.object.type !== "Identifier") return undefined;
  if (!schemaNamespaces.has(node.object.name)) return undefined;
  return getMemberName(node);
};

const isNonSchemaOperation = (name) =>
  name !== undefined
  && (NON_SCHEMA_MEMBERS.has(name)
    || CODEC_OPERATION.test(name)
    || NON_SCHEMA_PREFIXES.some((prefix) => name.startsWith(prefix)));

const isSchemaExpression = (node, schemaNamespaces) => {
  if (!node) return false;

  const directMember = getSchemaMember(node, schemaNamespaces);
  if (directMember !== undefined) return !isNonSchemaOperation(directMember);

  if (node.type === "CallExpression") {
    const operation = getSchemaMember(node.callee, schemaNamespaces);
    if (isNonSchemaOperation(operation)) return false;
    if (operation !== undefined) return true;
    return isSchemaExpression(node.callee, schemaNamespaces)
      || node.arguments.some((argument) =>
        argument.type !== "SpreadElement"
        && isSchemaExpression(argument, schemaNamespaces)
      );
  }

  if (
    node.type === "ChainExpression"
    || node.type === "TSAsExpression"
    || node.type === "TSSatisfiesExpression"
    || node.type === "TSNonNullExpression"
    || node.type === "TSTypeAssertion"
  ) {
    return isSchemaExpression(node.expression, schemaNamespaces);
  }

  if (node.type === "MemberExpression") {
    return isSchemaExpression(node.object, schemaNamespaces);
  }

  if (node.type === "ConditionalExpression") {
    return isSchemaExpression(node.consequent, schemaNamespaces)
      || isSchemaExpression(node.alternate, schemaNamespaces);
  }

  if (node.type === "LogicalExpression") {
    return isSchemaExpression(node.left, schemaNamespaces)
      || isSchemaExpression(node.right, schemaNamespaces);
  }

  if (node.type === "ArrayExpression") {
    return node.elements.some((element) =>
      element !== null
      && element.type !== "SpreadElement"
      && isSchemaExpression(element, schemaNamespaces)
    );
  }

  return false;
};

const isSchemaClass = (node, schemaNamespaces) => {
  let expression = node.superClass;
  while (expression?.type === "CallExpression") expression = expression.callee;
  const member = getSchemaMember(expression, schemaNamespaces);
  return member !== undefined && SCHEMA_CLASS_BUILDERS.has(member);
};

const getTopLevelDeclaration = (statement) =>
  statement.type === "ExportNamedDeclaration"
    || statement.type === "ExportDefaultDeclaration"
    ? statement.declaration
    : statement;

const create = (context) => ({
  "Program:exit"(program) {
    const schemaNamespaces = new Set();
    const typeDeclarations = [];

    for (const statement of program.body) {
      if (
        statement.type === "ImportDeclaration"
        && statement.source.value === "effect/Schema"
      ) {
        for (const specifier of statement.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            schemaNamespaces.add(specifier.local.name);
          }
        }
      }
    }

    if (schemaNamespaces.size === 0) return;

    let hasSchemaDeclaration = false;
    for (const statement of program.body) {
      const declaration = getTopLevelDeclaration(statement);
      if (!declaration) continue;

      if (
        declaration.type === "TSInterfaceDeclaration"
        || declaration.type === "TSTypeAliasDeclaration"
      ) {
        typeDeclarations.push(declaration);
      } else if (declaration.type === "VariableDeclaration") {
        hasSchemaDeclaration ||= declaration.declarations.some(({ init }) =>
          isSchemaExpression(init, schemaNamespaces)
        );
      } else if (
        declaration.type === "ClassDeclaration"
        && isSchemaClass(declaration, schemaNamespaces)
      ) {
        hasSchemaDeclaration = true;
      }
    }

    if (!hasSchemaDeclaration) return;
    for (const declaration of typeDeclarations) {
      context.report({ node: declaration, messageId: "mixedDeclaration" });
    }
  },
});

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require runtime Effect Schema declarations and TypeScript type declarations to live in separate files.",
    },
    messages: {
      mixedDeclaration:
        "Move this interface or type alias to a separate types file; files declaring runtime Effect Schemas must not also declare TypeScript interfaces or type aliases.",
    },
    schema: [],
  },
  create,
};
