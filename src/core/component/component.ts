// The universal base object — TDD §2.

import { ComponentKindMismatchError } from "../errors";
import type {
  ComponentContext,
  ComponentInspection,
  ComponentInstance,
  ComponentKind,
  ComponentManifest,
  InspectionView,
  ProtocolId,
} from "../types";
import { createComponentInspection } from "./inspection";

export abstract class Component<
  Kind extends ComponentKind = ComponentKind,
  Config = unknown,
> {
  readonly #kind: Kind;

  protected constructor(
    public readonly instance: ComponentInstance,
    protected readonly config: Readonly<Config>,
    protected readonly context: ComponentContext,
    expectedKind: Kind,
  ) {
    // Runtime check replaces an unchecked `as Kind` cast, which would let a
    // Component<"tool"> wrap an agent manifest and still type-check.
    if (instance.manifest.schema.kind !== expectedKind) {
      throw new ComponentKindMismatchError(
        expectedKind,
        instance.manifest.schema.kind,
      );
    }
    this.#kind = expectedKind;
  }

  public get manifest(): ComponentManifest {
    return this.instance.manifest;
  }

  public get kind(): Kind {
    return this.#kind;
  }

  public supports(protocol: ProtocolId): boolean {
    return this.manifest.protocols.some(
      (candidate) => candidate.id === protocol,
    );
  }

  public inspect(view: InspectionView = "model"): ComponentInspection {
    return createComponentInspection(this, view);
  }

  /** Lifecycle is a state machine enforced by the kernel, not empty hooks.
   *  Legal transitions: created→opening→open→draining→closed; any state→failed.
   *  Because instances hold grants, lifecycle bugs are security bugs; the
   *  kernel releases the GrantHandle on entry to `closed` or `failed`. */
  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}

  /** @internal Lifecycle entrypoints are invoked only by the kernel-owned
   * instance state machine. */
  public openForKernel(): Promise<void> {
    return this.onOpen();
  }

  /** @internal See {@link openForKernel}. */
  public closeForKernel(): Promise<void> {
    return this.onClose();
  }
}
