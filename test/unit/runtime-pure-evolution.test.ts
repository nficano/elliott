import { describe, expect, it } from "bun:test";
import { parseEvolutionResumeToken } from "../../src/runtime/evolution";

describe("parseEvolutionResumeToken", () => {
  it("parses a text-routed token", () => {
    expect(parseEvolutionResumeToken("text:abc123")).toEqual({
      route: "text",
      token: "abc123",
    });
  });

  it("parses a code-routed token", () => {
    expect(parseEvolutionResumeToken("code:xyz")).toEqual({
      route: "code",
      token: "xyz",
    });
  });

  it("keeps later colons inside the token (only the first splits)", () => {
    expect(parseEvolutionResumeToken("code:a:b:c")).toEqual({
      route: "code",
      token: "a:b:c",
    });
  });

  it("allows an empty token after the separator", () => {
    expect(parseEvolutionResumeToken("text:")).toEqual({
      route: "text",
      token: "",
    });
  });

  it("errors when there is no route separator", () => {
    expect(parseEvolutionResumeToken("abc123")).toEqual({
      error: "resume token has no engine route",
    });
  });

  it("errors on an unknown route prefix", () => {
    expect(parseEvolutionResumeToken("darwin:abc")).toEqual({
      error: "resume token has an unknown engine route",
    });
  });

  it("treats an empty route prefix as unknown", () => {
    expect(parseEvolutionResumeToken(":abc")).toEqual({
      error: "resume token has an unknown engine route",
    });
  });
});
