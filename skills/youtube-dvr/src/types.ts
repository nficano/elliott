import type { YouTubeDvrSettings } from "../../../src/runtime/types";

export interface AccessTokenSource {
  token(): Promise<string>;
}

export interface Upload {
  readonly videoId: string;
  readonly publishedAt: string;
  readonly title: string;
}

export interface YouTubeClient {
  uploads(handle: string): Promise<readonly Upload[]>;
  durationSeconds(videoId: string): Promise<number>;
  createPlaylist(title: string, privacy: string): Promise<string>;
  addToPlaylist(playlistId: string, videoId: string): Promise<void>;
}

export interface DvrState {
  readonly addedVideoIds: readonly string[];
  readonly playlists: Readonly<Record<string, string>>;
}

export interface DvrStore {
  load(): Promise<DvrState>;
  markAdded(videoId: string): Promise<void>;
  setPlaylist(dateKey: string, playlistId: string): Promise<void>;
}

export interface SourceProvider {
  readonly name: string;
  readonly days: readonly string[];
  resolve(): Promise<string | undefined>;
}

export interface DvrDeps {
  readonly settings: YouTubeDvrSettings;
  readonly client: YouTubeClient;
  readonly store: DvrStore;
  readonly providers: readonly SourceProvider[];
  report(error: unknown, mechanism: string): void;
}

export interface DvrRun {
  readonly deps: DvrDeps;
  readonly target: Date;
  readonly backfill: boolean;
}

export interface DvrRunOptions {
  readonly date?: string;
}

export interface DvrRunResult {
  readonly playlist: string;
  readonly playlistId: string;
  readonly added: readonly string[];
  readonly skipped: number;
  readonly note?: string;
}

export interface DvrEngine {
  run(options: DvrRunOptions): Promise<DvrRunResult>;
}
