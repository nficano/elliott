// Thrown when the governance layer refuses a tool invocation (policy deny, a
// runtime kill-switch disable, or a global freeze). RuntimeAgent.#execute
// already turns a thrown tool error into an "[error]" tool message, so a denial
// surfaces to the model as an ordinary un-actionable result — the model learns
// it cannot take that action without the process crashing.
export class GovernanceDeniedError extends Error {
  readonly tool: string;
  readonly reason: string;

  constructor(tool: string, reason: string) {
    super(`Tool ${tool} denied: ${reason}`);
    this.name = "GovernanceDeniedError";
    this.tool = tool;
    this.reason = reason;
  }
}
