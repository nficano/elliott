export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface ResultLink {
  readonly close: number;
  readonly href: string;
  readonly title: string;
}
