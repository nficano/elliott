// Introspection surface (`dir()` / `help()` analog) — TDD §7.3, §7.5b.

import type {
  ComponentInspection,
  ComponentLike,
  InspectionView,
} from "../types";

export const createComponentInspection = (
  component: ComponentLike,
  view: InspectionView,
): ComponentInspection => ({
  ref: component.manifest.ref,
  kind: component.manifest.schema.kind,
  description: component.manifest.description,
  protocols: component.manifest.protocols.map((protocol) => protocol.id),
  view,
});
