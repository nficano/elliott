import type {
  ComponentRef,
  DataClassification,
  PrincipalId,
} from "../core/types";
import type { Envelope, RecordAppender } from "../core/waist/types";

export type GatewayProtocolId =
  | "message.source"
  | "message.sink"
  | "identity.resolver"
  | "attachment.reader"
  | "delivery.describer"
  | "health.checker";

export interface GatewayRoute {
  readonly id: string;
  readonly agent: ComponentRef;
  readonly tenant: string;
  readonly account: string;
  readonly channel: string;
  readonly classification: DataClassification;
  readonly requireVerification: boolean;
  readonly allowedPrincipals: ReadonlySet<PrincipalId>;
}

export interface GatewayIdentityLink {
  readonly gateway: string;
  readonly account: string;
  readonly externalId: string;
  readonly principal: PrincipalId;
}

export interface GatewayAttachment {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface InboundGatewayPayload {
  readonly idempotencyKey: string;
  readonly routeId: string;
  readonly externalId: string;
  readonly displayName?: string;
  readonly thread: string;
  readonly body: string;
  readonly signature?: string;
  readonly attachments: readonly GatewayAttachment[];
  readonly receivedAt: string;
}

export interface NormalizedGatewayMessage {
  readonly text: string;
  readonly quarantinedAttachmentIds: readonly string[];
}

export interface GatewaySessionKey {
  readonly tenant: string;
  readonly gatewayAccount: string;
  readonly channel: string;
  readonly thread: string;
  readonly principal: PrincipalId;
}

export interface AcceptedInbound {
  readonly type: "accepted";
  readonly envelope: Envelope<NormalizedGatewayMessage>;
  readonly agent: ComponentRef;
  readonly session: GatewaySessionKey;
}

export interface DroppedInbound {
  readonly type: "dropped";
  readonly reason:
    | "duplicate"
    | "unverified"
    | "unknown-identity"
    | "unauthorized";
}

export type InboundGatewayResult = AcceptedInbound | DroppedInbound;

export interface OutboundGatewayPayload {
  readonly routeId: string;
  readonly destination: string;
  readonly envelope: Envelope<string>;
}

export interface DeliveryReceipt {
  readonly id: string;
  readonly routeId: string;
  readonly destination: string;
  readonly deliveredAt: string;
  readonly platformReceipt: string;
}

export interface GatewayVerifier {
  verify(route: GatewayRoute, payload: InboundGatewayPayload): Promise<boolean>;
}

export interface GatewayAuthorizer {
  authorize(principal: PrincipalId, route: GatewayRoute): Promise<boolean>;
}

export interface GatewayAttachmentQuarantine {
  quarantine(attachment: GatewayAttachment): Promise<string>;
}

export interface GatewayDeliveryAdapter {
  deliver(destination: string, rendered: string): Promise<string>;
}

export interface GatewayPolicy {
  allowOutbound(payload: OutboundGatewayPayload): Promise<boolean>;
}

export interface GatewayPipelineDependencies {
  readonly verifier: GatewayVerifier;
  readonly authorizer: GatewayAuthorizer;
  readonly quarantine: GatewayAttachmentQuarantine;
  readonly delivery: GatewayDeliveryAdapter;
  readonly policy: GatewayPolicy;
  readonly records: RecordAppender;
}

export interface GatewayPipelineConfig {
  readonly id: string;
  readonly routes: readonly GatewayRoute[];
  readonly identities: readonly GatewayIdentityLink[];
}
