export interface HostRecord {
  readonly ip: string;
  readonly domains: readonly string[];
}

export interface CnameRecord {
  readonly alias: string;
  readonly target: string;
  readonly ttl?: string;
}

export interface DnsSnapshot {
  readonly hosts: readonly HostRecord[];
  readonly cnames: readonly CnameRecord[];
}

export interface PiholeBackend {
  readonly mode: "v6" | "v5";
  snapshot(): Promise<DnsSnapshot>;
  addHost(ip: string, domain: string): Promise<void>;
  removeHost(record: HostRecord, domain: string): Promise<void>;
  addCname(alias: string, target: string): Promise<void>;
  removeCname(record: CnameRecord): Promise<void>;
}

export type PiholeBackendSource = () => Promise<PiholeBackend>;
