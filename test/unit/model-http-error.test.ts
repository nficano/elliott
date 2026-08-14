import { describe, expect, it } from "bun:test";
import { ModelHttpError } from "../../src/runtime/model/client";

// A non-2xx response body is endpoint-controlled text, and the endpoint is the
// one party GIVEN the api key — so a hostile one can echo the key back, whole,
// sliced, or re-encoded, and no value-matching scrub over attacker-chosen bytes
// is safe. ModelHttpError therefore carries only the wire name and the HTTP
// status (a fact the process derived); it does not accept or forward the body.
// The runtime's reporter writes an exception's message to the process log, and
// container logs ship off-box in any real deployment, so a credential must never
// reach the message in the first place.

describe("ModelHttpError", () => {
  it("derives its message from the wire and status alone", () => {
    const error = new ModelHttpError("Anthropic", 401);
    expect(error.message).toBe("Anthropic 401");
    expect(error.status).toBe(401);
    expect(error.name).toBe("ModelHttpError");
  });

  it("cannot carry an endpoint body: the constructor takes no detail", () => {
    // The type has exactly two parameters; there is nowhere for an echoed
    // credential to enter. This is the whole guarantee — nothing forwarded,
    // nothing to scrub.
    expect(ModelHttpError.length).toBe(2);
  });

  it("keeps the status structured so a caller classifies from it, not the text", () => {
    for (const status of [401, 403, 429, 500, 529]) {
      const error = new ModelHttpError("OpenAI", status);
      expect(error.status).toBe(status);
      expect(error.message).toBe(`OpenAI ${status}`);
    }
  });
});
