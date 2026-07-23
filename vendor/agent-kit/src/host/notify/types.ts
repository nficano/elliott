export interface WebhookNotifyConfig {
  readonly webhookUrl: string;
  readonly token?: string;
  readonly defaultChannels: string[];
}
