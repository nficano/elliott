import type { IncrementalScanner } from "../../hotcore/types";
import type { PreparedExecution, StreamInspectionResult } from "./types";

export class StreamedArgumentInspector<Result> {
  readonly #scanner: IncrementalScanner;
  readonly #prepare: () => Promise<PreparedExecution<Result>>;
  #prepared: Promise<PreparedExecution<Result>> | undefined;
  #buffer = "";
  #blocked = false;
  #complete = false;

  constructor(
    scanner: IncrementalScanner,
    prepare: () => Promise<PreparedExecution<Result>>,
  ) {
    this.#scanner = scanner;
    this.#prepare = prepare;
  }

  async push(
    delta: string,
    complete: boolean,
  ): Promise<StreamInspectionResult<Result>> {
    if (this.#complete) throw new Error("Argument block already completed");
    this.#prepared ??= this.#prepare();
    this.#buffer += delta;
    if (this.#scanner.push(delta).length > 0) this.#blocked = true;
    if (!complete) return { status: "pending" };
    this.#complete = true;
    const prepared = await this.#prepared;
    if (this.#blocked) {
      await prepared.discard();
      return { status: "blocked" };
    }
    const result = await prepared.commit(this.#buffer);
    return { status: "dispatched", result };
  }
}
