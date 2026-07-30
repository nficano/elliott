// Static component module definition — TDD §7.5. Discovery never imports
// executable code; defineComponent is evaluated only inside isolated workers.

import type { ComponentDefinition, ComponentModule } from "../types";

const validateDefinition = <Config>(
  definition: ComponentDefinition<Config>,
): void => {
  if (!definition.manifest.ref) {
    throw new Error("Component definition requires a manifest ref");
  }
};

export function defineComponent<Config>(
  definition: ComponentDefinition<Config>,
  factory: ComponentModule<Config>["create"],
): ComponentModule<Config> {
  validateDefinition(definition);
  return Object.freeze({ definition, create: factory });
}
