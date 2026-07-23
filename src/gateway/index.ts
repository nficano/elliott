import { scopeId } from "../core/brands";
import { newId } from "../core/digest";
import type { PrincipalId } from "../core/types";
import type {
  DeliveryReceipt,
  GatewayIdentityLink,
  GatewayPipelineConfig,
  GatewayPipelineDependencies,
  GatewayRoute,
  InboundGatewayPayload,
  InboundGatewayResult,
  OutboundGatewayPayload,
} from "./types";

export class WebhookHmacVerifier {
  readonly #secrets: ReadonlyMap<string, Uint8Array>;

  constructor(secrets: ReadonlyMap<string, Uint8Array>) {
    this.#secrets = secrets;
  }

  async verify(
    route: GatewayRoute,
    payload: InboundGatewayPayload,
  ): Promise<boolean> {
    const secret = this.#secrets.get(route.id);
    if (secret === undefined || payload.signature === undefined) return false;
    const expected = `sha256=${
      createHmac("sha256", secret).update(payload.body).digest("hex")
    }`;
    const actualBytes = Buffer.from(payload.signature);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length
      && timingSafeEqual(actualBytes, expectedBytes);
  }
}

const identityKey = (link: {
  readonly gateway: string;
  readonly account: string;
  readonly externalId: string;
}): string => `${link.gateway}\u{0}${link.account}\u{0}${link.externalId}`;

const sessionKey = (
  route: GatewayRoute,
  thread: string,
  principal: PrincipalId,
) =>
  Object.freeze({
    tenant: route.tenant,
    gatewayAccount: route.account,
    channel: route.channel,
    thread,
    principal,
  });

export class GatewayPipeline {
  readonly #config: GatewayPipelineConfig;
  readonly #dependencies: GatewayPipelineDependencies;
  readonly #routes: ReadonlyMap<string, GatewayRoute>;
  readonly #identities: ReadonlyMap<string, GatewayIdentityLink>;
  readonly #seen = new Set<string>();

  constructor(
    config: GatewayPipelineConfig,
    dependencies: GatewayPipelineDependencies,
  ) {
    this.#config = config;
    this.#dependencies = dependencies;
    this.#routes = new Map(config.routes.map((route) => [route.id, route]));
    this.#identities = new Map(
      config.identities.map((link) => [identityKey(link), link]),
    );
  }

  async inbound(payload: InboundGatewayPayload): Promise<InboundGatewayResult> {
    const route = this.#routes.get(payload.routeId);
    if (route === undefined) return this.#drop(payload, "unauthorized");
    if (this.#seen.has(payload.idempotencyKey)) {
      return this.#drop(payload, "duplicate");
    }
    const verified = !route.requireVerification
      || await this.#dependencies.verifier.verify(route, payload);
    if (!verified) return this.#drop(payload, "unverified");
    const principal = this.#resolveIdentity(route, payload.externalId);
    if (principal === undefined) return this.#drop(payload, "unknown-identity");
    const authorized = route.allowedPrincipals.has(principal)
      && await this.#dependencies.authorizer.authorize(principal, route);
    if (!authorized) return this.#drop(payload, "unauthorized");
    this.#seen.add(payload.idempotencyKey);
    const attachmentIds = await Promise.all(
      payload.attachments.map((item) =>
        this.#dependencies.quarantine.quarantine(item)
      ),
    );
    return Object.freeze({
      type: "accepted",
      agent: route.agent,
      session: sessionKey(route, payload.thread, principal),
      envelope: Object.freeze({
        id: newId("gateway"),
        principal,
        actorTrust: "authenticated",
        contentTrust: "untrusted",
        classification: route.classification,
        securityTags: Object.freeze([{
          source: route.agent,
          classification: route.classification,
          reason: `gateway:${this.#config.id}:${route.id}`,
        }]),
        payload: Object.freeze({
          text: payload.body,
          quarantinedAttachmentIds: Object.freeze(attachmentIds),
        }),
        createdAt: payload.receivedAt,
      }),
    });
  }

  async outbound(payload: OutboundGatewayPayload): Promise<DeliveryReceipt> {
    const route = this.#routes.get(payload.routeId);
    if (
      route === undefined
      || !await this.#dependencies.policy.allowOutbound(payload)
    ) {
      throw new Error("Gateway outbound policy denied delivery");
    }
    await this.#dependencies.records.append({
      type: "gateway.delivery-intent",
      scope: { level: "agent", id: scopeId(route.agent) },
      durability: "effect-gating",
      classification: payload.envelope.classification,
      payload: { routeId: route.id, destination: payload.destination },
    });
    const platformReceipt = await this.#dependencies.delivery.deliver(
      payload.destination,
      payload.envelope.payload,
    );
    const receipt = Object.freeze({
      id: newId("delivery"),
      routeId: route.id,
      destination: payload.destination,
      deliveredAt: new Date().toISOString(),
      platformReceipt,
    });
    await this.#dependencies.records.append({
      type: "gateway.delivery",
      scope: { level: "agent", id: scopeId(route.agent) },
      durability: "observational",
      classification: payload.envelope.classification,
      payload: receipt,
    });
    return receipt;
  }

  #resolveIdentity(
    route: GatewayRoute,
    externalId: string,
  ): PrincipalId | undefined {
    return this.#identities.get(identityKey({
      gateway: this.#config.id,
      account: route.account,
      externalId,
    }))?.principal;
  }

  async #drop(
    payload: InboundGatewayPayload,
    reason: "duplicate" | "unverified" | "unknown-identity" | "unauthorized",
  ): Promise<InboundGatewayResult> {
    await this.#dependencies.records.append({
      type: "gateway.inbound-dropped",
      scope: { level: "session", id: scopeId(payload.idempotencyKey) },
      durability: "observational",
      classification: "internal",
      payload: { routeId: payload.routeId, reason },
    });
    return Object.freeze({ type: "dropped", reason });
  }
}

export type * from "./types";
import { createHmac, timingSafeEqual } from "node:crypto";
