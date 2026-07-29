import noMixedSchemaTypes from "./no-mixed-schema-types.js";
import noTypesOutsideTypeModules from "./no-types-outside-type-modules.js";

export default {
  rules: {
    "no-mixed-schema-types": noMixedSchemaTypes,
    "no-types-outside-type-modules": noTypesOutsideTypeModules,
  },
};
