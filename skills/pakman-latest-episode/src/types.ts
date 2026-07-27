export interface PakmanEpisode {
  readonly url: string;
  readonly videoId: string;
}

export interface PakmanCredentials {
  readonly username: string;
  readonly password: string;
}

export interface PakmanResolver {
  latest(): Promise<PakmanEpisode>;
}

export interface JarRequest {
  readonly method: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export const asPakmanCredentials = (
  value: unknown,
): PakmanCredentials | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  if (!("username" in value) || !("password" in value)) return undefined;
  const { username, password } = value;
  if (typeof username !== "string" || typeof password !== "string") {
    return undefined;
  }
  return { username, password };
};
