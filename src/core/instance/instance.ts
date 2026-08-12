import { LifecycleHookError, LifecycleTransitionError } from "../errors";
import type { ComponentInstance, LifecycleState } from "../types";
import type { LifecycleHooks, ManagedInstanceView } from "./types";

/** Legal lifecycle edges: created→opening→open→draining→closed, any→failed. */
const LIFECYCLE_TRANSITIONS: Readonly<
  Record<LifecycleState, readonly LifecycleState[]>
> = {
  created: ["opening", "failed"],
  opening: ["open", "failed"],
  open: ["draining", "failed"],
  draining: ["closed", "failed"],
  closed: [],
  failed: [],
};

/** Throws {@link LifecycleTransitionError} when `from → to` is not a legal
 *  lifecycle edge. Pure: consults only the static transition matrix. */
export const assertTransition = (
  from: LifecycleState,
  to: LifecycleState,
): void => {
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new LifecycleTransitionError(from, to);
  }
};

export class ManagedComponentInstance {
  readonly #base: ComponentInstance;
  readonly #hooks: LifecycleHooks;
  #state: LifecycleState;
  #released = false;

  constructor(
    base: ComponentInstance,
    hooks: LifecycleHooks,
  ) {
    this.#base = base;
    this.#hooks = hooks;
    this.#state = base.lifecycle;
  }

  get state(): LifecycleState {
    return this.#state;
  }

  view(): ManagedInstanceView {
    return {
      value: Object.freeze({ ...this.#base, lifecycle: this.#state }),
      released: this.#released,
    };
  }

  async open(): Promise<void> {
    assertTransition(this.#state, "opening");
    this.#state = "opening";
    try {
      await this.#hooks.open();
      this.#state = "open";
    } catch (error) {
      this.#state = "failed";
      await this.#release();
      throw new LifecycleHookError("open", error);
    }
  }

  drain(): void {
    assertTransition(this.#state, "draining");
    this.#state = "draining";
  }

  async close(): Promise<void> {
    if (this.#state === "open") this.#state = "draining";
    assertTransition(this.#state, "closed");
    try {
      await this.#hooks.close();
      this.#state = "closed";
      await this.#release();
    } catch (error) {
      this.#state = "failed";
      await this.#release();
      throw new LifecycleHookError("close", error);
    }
  }

  async fail(): Promise<void> {
    assertTransition(this.#state, "failed");
    this.#state = "failed";
    await this.#release();
  }

  async #release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#hooks.releaseGrant();
  }
}
