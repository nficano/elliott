export interface Story {
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly publishedAt: string;
}

export interface NewsSource {
  readonly name: string;
  readonly intervalSeconds: number;
  fetch(): Promise<readonly Story[]>;
}

export interface AggregatedStory {
  readonly key: string;
  title: string;
  url: string;
  readonly sources: Set<string>;
  mentions: number;
  readonly firstSeen: number;
  lastSeen: number;
  publishedAt: string;
}

export interface ScoredStory {
  readonly title: string;
  readonly url: string;
  readonly sources: readonly string[];
  readonly score: number;
  readonly publishedAt: string;
  readonly breaking: boolean;
}

export interface NewsEngine {
  refresh(): Promise<void>;
  brief(): readonly ScoredStory[];
}

export interface AlertStore {
  seen(): Promise<ReadonlySet<string>>;
  mark(key: string): Promise<void>;
}

export interface RedditSourceConfig {
  readonly multireddit: string;
  readonly intervalSeconds: number;
}

export interface GuardianSourceConfig {
  readonly apiKey: string;
  readonly sections: readonly string[];
  readonly intervalSeconds: number;
}

export interface RssFeedConfig {
  readonly name: string;
  readonly url: string;
}

export interface RssSourceConfig {
  readonly feeds: readonly RssFeedConfig[];
  readonly intervalSeconds: number;
}

export interface ApiSourceConfig {
  readonly apiKey: string;
  readonly intervalSeconds: number;
}
