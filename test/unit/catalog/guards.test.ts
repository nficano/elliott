import { describe, expect, it } from "bun:test";
import {
  assertBrokeredDestination,
  assertWorkspacePath,
  stripActiveContent,
} from "../../../src/catalog/guards";

describe("catalog guards", () => {
  it("keeps paths inside the workspace grant", () => {
    expect(assertWorkspacePath("/var/ws/a.txt", {
      root: "/var/ws",
      additionalRoots: [],
    })).toBe("/var/ws/a.txt");
    expect(() =>
      assertWorkspacePath("/etc/passwd", {
        root: "/var/ws",
        additionalRoots: [],
      })
    ).toThrow(/escapes/);
    expect(assertWorkspacePath("/extra/a", {
      root: "/var/ws",
      additionalRoots: ["/extra"],
    })).toBe("/extra/a");
  });

  it("strips script and style elements", () => {
    expect(stripActiveContent(
      "<p>hi</p><script>evil()</script><style>x{}</style><b>ok</b>",
    )).toBe("<p>hi</p><b>ok</b>");
  });

  it("asserts brokered destinations against egress policy", () => {
    const policy = {
      kind: "declared" as const,
      hosts: ["example.com"],
    };
    expect(() => assertBrokeredDestination("example.com", policy)).not
      .toThrow();
    expect(() => assertBrokeredDestination("evil.test", policy))
      .toThrow(/outside the egress grant/);
  });
});
