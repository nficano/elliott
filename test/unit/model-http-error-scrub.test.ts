import { afterEach, describe, expect, it, mock } from "bun:test";
import { ModelHttpError } from "../../src/runtime/model/client";

// A non-2xx body is endpoint-controlled text, and the endpoint is the one party
// that is GIVEN the api key — so a hostile or compromised one can quote the key
// straight back. The runtime's reporter writes an exception's full message to the
// process log, and CLAUDE.md's doctrine forbids LOGGING a secret, not merely
// transmitting one: container logs are shipped off-box in any real deployment, so
// "local console only" is not a safe resting place for a credential.

afterEach(() => {
  mock.restore();
});

describe("ModelHttpError", () => {
  it("redacts the api key an endpoint echoes back", () => {
    const key = "sk-live-leak";
    const error = new ModelHttpError(
      "Anthropic",
      401,
      `invalid key: ${key}`,
      key,
    );
    expect(error.message).not.toContain(key);
    expect(error.message).toContain("Anthropic 401");
    // The status stays structured so a caller still classifies the failure.
    expect(error.status).toBe(401);
  });

  it("strips inline URL credentials no api key would match", () => {
    const error = new ModelHttpError(
      "OpenAI",
      502,
      "upstream https://user:hunter2@proxy.internal/v1 refused",
      "sk-other",
    );
    expect(error.message).not.toContain("hunter2");
    // The host survives — it is the actionable part of the diagnosis.
    expect(error.message).toContain("proxy.internal");
  });

  it("keeps the body readable when it holds no credential", () => {
    const error = new ModelHttpError(
      "Anthropic",
      429,
      "rate limit exceeded, retry in 30s",
      "sk-live-key",
    );
    expect(error.message).toContain("rate limit exceeded, retry in 30s");
  });

  it("tolerates an absent or blank key without redacting everything", () => {
    // A blank key must not become an empty-string match that replaces at every
    // position and destroys the message.
    for (const key of [undefined, "", " ".repeat(3)]) {
      const error = new ModelHttpError("OpenAI", 500, "server error", key);
      expect(error.message).toContain("server error");
    }
  });
});
