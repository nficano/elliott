import path from "node:path";
import { digest } from "../core/brands";
import { egressAllows, egressClass } from "../placement/egress";
import type { BundledComponentDescriptor, WorkspacePathGrant } from "./types";

const descriptor = (
  input: BundledComponentDescriptor,
): BundledComponentDescriptor => Object.freeze(input);

const browserCompanion = Object.freeze({
  name: "chromium",
  image: "ghcr.io/elliott/agent-browser@sha256:bundled",
  egress: egressClass("declared"),
  endpoint: "cdp",
  tmpfs: Object.freeze(["/profile"]),
  secretRefs: Object.freeze([]),
  manifestDigest: digest("sha256:bundled-browser"),
});

const cloudflaredCompanion = Object.freeze({
  name: "cloudflared",
  image: "cloudflare/cloudflared@sha256:bundled",
  egress: egressClass("declared", ["cloudflare-edge"]),
  endpoint: "webhook-only",
  tmpfs: Object.freeze([]),
  secretRefs: Object.freeze(["secret://gateways/cloudflared/tunnel-token"]),
  manifestDigest: digest("sha256:bundled-cloudflared"),
});

export const BUNDLED_CATALOG: readonly BundledComponentDescriptor[] = Object
  .freeze([
    descriptor({
      name: "search-duckduckgo",
      kind: "tool",
      protocols: ["search.provider"],
      egress: egressClass("declared", ["duckduckgo.com"]),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "search-brave",
      kind: "tool",
      protocols: ["search.provider"],
      egress: egressClass("declared", ["api.search.brave.com"]),
      isolation: "container",
      secretRefs: ["secret://search/brave/api-key"],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "web-firecrawl",
      kind: "tool",
      protocols: ["search.provider", "content.extractor"],
      egress: egressClass("declared", ["api.firecrawl.dev"]),
      isolation: "container",
      secretRefs: ["secret://web/firecrawl/api-key"],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "web-parallel",
      kind: "tool",
      protocols: ["search.provider", "content.extractor"],
      egress: egressClass("declared", ["api.parallel.ai"]),
      isolation: "container",
      secretRefs: ["secret://web/parallel/api-key"],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "browser",
      kind: "extension",
      protocols: ["tool.executor"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
      companion: browserCompanion,
    }),
    descriptor({
      name: "gateway-slack",
      kind: "gateway",
      protocols: ["message.source", "message.sink", "identity.resolver"],
      egress: egressClass("declared", ["slack.com", "slack-edge.com"]),
      isolation: "container",
      secretRefs: [
        "secret://gateways/slack/bot-token",
        "secret://gateways/slack/signing-secret",
      ],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "gateway-email",
      kind: "gateway",
      protocols: ["message.source", "message.sink"],
      egress: egressClass("declared", ["mail-hosts"]),
      isolation: "container",
      secretRefs: ["secret://gateways/email/credentials"],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "gateway-gmail",
      kind: "gateway",
      protocols: ["message.source", "message.sink"],
      egress: egressClass("declared", ["googleapis.com"]),
      isolation: "container",
      secretRefs: ["secret://gateways/gmail/refresh-token"],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "gateway-webhook",
      kind: "gateway",
      protocols: ["message.source"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: ["secret://gateways/webhook/signing-secret"],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "cloudflared",
      kind: "extension",
      protocols: ["health.checker"],
      egress: egressClass("declared", ["cloudflare-edge"]),
      isolation: "container",
      secretRefs: ["secret://gateways/cloudflared/tunnel-token"],
      senderAllowlistRequired: false,
      untrustedOutput: false,
      companion: cloudflaredCompanion,
    }),
    descriptor({
      name: "gateway-home-assistant",
      kind: "gateway",
      protocols: ["message.source", "message.sink", "tool.executor"],
      egress: egressClass("lan"),
      isolation: "container",
      secretRefs: ["secret://gateways/home-assistant/token"],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "gateway-bluebubbles",
      kind: "gateway",
      protocols: ["message.source", "message.sink"],
      egress: egressClass("lan"),
      isolation: "remote",
      secretRefs: ["secret://gateways/bluebubbles/password"],
      senderAllowlistRequired: true,
      untrustedOutput: true,
    }),
    descriptor({
      name: "files",
      kind: "tool",
      protocols: ["resource.reader", "resource.writer"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "terminal",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("none"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "ssh",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: ["secret://tools/ssh/private-key"],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
    descriptor({
      name: "fetch",
      kind: "tool",
      protocols: ["tool.executor"],
      egress: egressClass("declared"),
      isolation: "container",
      secretRefs: [],
      senderAllowlistRequired: false,
      untrustedOutput: true,
    }),
  ]);

const contains = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(
    path.resolve(root),
    path.resolve(candidate),
  );
  return relativePath.length === 0
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const assertWorkspacePath = (
  candidate: string,
  grant: WorkspacePathGrant,
): string => {
  const roots = [grant.root, ...grant.additionalRoots];
  if (roots.every((root) => !contains(root, candidate))) {
    throw new Error("Path escapes the workspace grant");
  }
  return path.resolve(candidate);
};

const removeElement = (input: string, name: string): string => {
  let output = input;
  const open = `<${name}`;
  const close = `</${name}>`;
  for (;;) {
    const lower = output.toLowerCase();
    const start = lower.indexOf(open);
    if (start === -1) return output;
    const end = lower.indexOf(close, start);
    output = end === -1
      ? output.slice(0, start)
      : output.slice(0, start) + output.slice(end + close.length);
  }
};

export const stripActiveContent = (input: string): string => {
  const withoutScripts = removeElement(input, "script");
  return removeElement(withoutScripts, "style");
};

export const assertBrokeredDestination = (
  destination: string,
  policy: BundledComponentDescriptor["egress"],
): void => {
  if (!egressAllows(policy, destination)) {
    throw new Error(`Destination ${destination} is outside the egress grant`);
  }
};

export type * from "./types";
