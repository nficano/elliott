import { LifecycleHookError, LifecycleTransitionError } from "../errors";
import type { ComponentInstance, LifecycleState } from "../types";
import type { LifecycleHooks, ManagedInstanceView } from "./types";

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
    this.#expect("created", "opening");
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
    this.#expect("open", "draining");
    this.#state = "draining";
  }

  async close(): Promise<void> {
    if (this.#state === "open") this.#state = "draining";
    this.#expect("draining", "closed");
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
    if (this.#state === "closed" || this.#state === "failed") {
      throw new LifecycleTransitionError(this.#state, "failed");
    }
    this.#state = "failed";
    await this.#release();
  }

  #expect(from: LifecycleState, to: LifecycleState): void {
    if (this.#state !== from) {
      throw new LifecycleTransitionError(this.#state, to);
    }
  }

  async #release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#hooks.releaseGrant();
  }
}
