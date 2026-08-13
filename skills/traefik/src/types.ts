export interface ManagedRoute {
  readonly hostname: string;
  readonly serviceUrl: string;
}

export type RouteTable = Readonly<Record<string, ManagedRoute>>;

export interface RouteStore {
  read(): Promise<RouteTable>;
  write(table: RouteTable): Promise<void>;
}
