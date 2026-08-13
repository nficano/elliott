import { isIP } from "node:net";

const IPV4_SEGMENTS = 4;
const IPV4_OCTET_MAX = 255;
const IPV4_OCTET_RADIX = 256;
const IPV4_BITS = 32;
const IPV6_UNIQUE_LOCAL_LOW = 0xFC_00;
const IPV6_UNIQUE_LOCAL_HIGH = 0xFD_FF;
const IPV6_LINK_LOCAL_LOW = 0xFE_80;
const IPV6_LINK_LOCAL_HIGH = 0xFE_BF;
const IPV6_MULTICAST_LOW = 0xFF_00;
const IPV6_MULTICAST_HIGH = 0xFF_FF;
const IPV4_MAPPED_IPV6 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/;
const IP_FAMILY_V4 = 4;
const IP_FAMILY_V6 = 6;

// CIDR prefix lengths used by RESERVED_IPV4_RANGES below, named so no bare
// number appears in the table itself.
const PREFIX_4 = 4;
const PREFIX_8 = 8;
const PREFIX_10 = 10;
const PREFIX_12 = 12;
const PREFIX_15 = 15;
const PREFIX_16 = 16;
const PREFIX_24 = 24;

// Reserved-range base addresses as 32-bit integers, one named constant per
// range so the table below never carries a bare dotted-quad literal.
const RESERVED_THIS_NETWORK = 0x00_00_00_00; // 0.0.0.0 — "this network"
const RESERVED_PRIVATE_10 = 0x0A_00_00_00; // 10.0.0.0 — private-use
const RESERVED_SHARED_CGNAT = 0x64_40_00_00; // 100.64.0.0 — shared address space (CGNAT)
const RESERVED_LOOPBACK = 0x7F_00_00_00; // 127.0.0.0 — loopback
const RESERVED_LINK_LOCAL_V4 = 0xA9_FE_00_00; // 169.254.0.0 — link-local
const RESERVED_PRIVATE_172 = 0xAC_10_00_00; // 172.16.0.0 — private-use
const RESERVED_IETF_PROTOCOL = 0xC0_00_00_00; // 192.0.0.0 — IETF protocol assignments
const RESERVED_DOC_TEST_NET_1 = 0xC0_00_02_00; // 192.0.2.0 — documentation (TEST-NET-1)
const RESERVED_6TO4_RELAY = 0xC0_58_63_00; // 192.88.99.0 — 6to4 relay anycast
const RESERVED_PRIVATE_192 = 0xC0_A8_00_00; // 192.168.0.0 — private-use
const RESERVED_BENCHMARKING = 0xC6_12_00_00; // 198.18.0.0 — benchmarking
const RESERVED_DOC_TEST_NET_2 = 0xC6_33_64_00; // 198.51.100.0 — documentation (TEST-NET-2)
const RESERVED_DOC_TEST_NET_3 = 0xCB_00_71_00; // 203.0.113.0 — documentation (TEST-NET-3)
const RESERVED_MULTICAST_V4 = 0xE0_00_00_00; // 224.0.0.0 — multicast
const RESERVED_FUTURE_USE = 0xF0_00_00_00; // 240.0.0.0 — reserved for future use + limited broadcast

// The full IANA IPv4 Special-Purpose Address Registry (RFC 6890 and its
// updates) — every block that is not globally-reachable unicast space. A
// destination is public only if it falls in NONE of these; enumerating the
// complete reserved set (rather than a handful of ranges someone happened to
// remember) is what catches CGNAT (100.64.0.0/10), documentation ranges,
// benchmarking space, multicast, and future-use space, not just RFC 1918 and
// loopback.
const RESERVED_IPV4_RANGES: readonly {
  readonly base: number;
  readonly prefixLength: number;
}[] = [
  { base: RESERVED_THIS_NETWORK, prefixLength: PREFIX_8 },
  { base: RESERVED_PRIVATE_10, prefixLength: PREFIX_8 },
  { base: RESERVED_SHARED_CGNAT, prefixLength: PREFIX_10 },
  { base: RESERVED_LOOPBACK, prefixLength: PREFIX_8 },
  { base: RESERVED_LINK_LOCAL_V4, prefixLength: PREFIX_16 },
  { base: RESERVED_PRIVATE_172, prefixLength: PREFIX_12 },
  { base: RESERVED_IETF_PROTOCOL, prefixLength: PREFIX_24 },
  { base: RESERVED_DOC_TEST_NET_1, prefixLength: PREFIX_24 },
  { base: RESERVED_6TO4_RELAY, prefixLength: PREFIX_24 },
  { base: RESERVED_PRIVATE_192, prefixLength: PREFIX_16 },
  { base: RESERVED_BENCHMARKING, prefixLength: PREFIX_15 },
  { base: RESERVED_DOC_TEST_NET_2, prefixLength: PREFIX_24 },
  { base: RESERVED_DOC_TEST_NET_3, prefixLength: PREFIX_24 },
  { base: RESERVED_MULTICAST_V4, prefixLength: PREFIX_4 },
  { base: RESERVED_FUTURE_USE, prefixLength: PREFIX_4 },
];

// A dotted-quad string as a plain (unsigned) integer. Uses multiplication
// rather than bitwise ops: JS bitwise operators coerce to SIGNED 32-bit
// integers, which mishandles octets whose value would set the sign bit
// (e.g. 240.0.0.0 and above) — multiplication stays a well within
// Number.MAX_SAFE_INTEGER and has no such edge case.
const ipv4ToInt = (address: string): number | undefined => {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== IPV4_SEGMENTS
    || parts.some((part) =>
      !Number.isSafeInteger(part) || part < 0 || part > IPV4_OCTET_MAX
    )
  ) {
    return undefined;
  }
  return parts.reduce(
    (accumulator, part) => accumulator * IPV4_OCTET_RADIX + part,
    0,
  );
};

const inIpv4Range = (
  address: number,
  range: { readonly base: number; readonly prefixLength: number; },
): boolean => {
  const blockSize = 2 ** (IPV4_BITS - range.prefixLength);
  return Math.floor(address / blockSize) === Math.floor(range.base / blockSize);
};

const privateIpv4 = (address: string): boolean => {
  const value = ipv4ToInt(address);
  if (value === undefined) return true; // unparseable — fail closed
  return RESERVED_IPV4_RANGES.some((range) => inIpv4Range(value, range));
};

// Reserved IPv6 hextet ranges, checked against the address's first hextet
// the same table-driven way as the IPv4 ranges above (keeps privateIpv6's
// branching flat rather than a chain of ||'d comparisons).
const IPV6_RESERVED_HEXTET_RANGES: readonly {
  readonly low: number;
  readonly high: number;
}[] = [
  { low: IPV6_UNIQUE_LOCAL_LOW, high: IPV6_UNIQUE_LOCAL_HIGH },
  { low: IPV6_LINK_LOCAL_LOW, high: IPV6_LINK_LOCAL_HIGH },
  { low: IPV6_MULTICAST_LOW, high: IPV6_MULTICAST_HIGH },
];

const privateIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const mapped = IPV4_MAPPED_IPV6.exec(normalized);
  if (mapped?.[1] !== undefined) return privateIpv4(mapped[1]);
  const firstHextet = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) return true; // unparseable — fail closed
  return IPV6_RESERVED_HEXTET_RANGES.some(
    (range) => firstHextet >= range.low && firstHextet <= range.high,
  );
};

// Classifies a single resolved IP literal (not a hostname) as reserved
// (non-globally-routable) or public. Used by publicUrl in ./http to check
// every address a hostname resolves to, not just the hostname's text.
export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === IP_FAMILY_V4) return privateIpv4(address);
  if (family === IP_FAMILY_V6) return privateIpv6(address);
  return true; // not a recognizable IP literal from a resolver — fail closed
};
