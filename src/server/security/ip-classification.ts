import ipaddr from "ipaddr.js";

const publicUnicastRange = "unicast";

const blockedRanges = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "carrierGradeNat",
  "private",
  "reserved",
  "uniqueLocal",
  "rfc6598",
]);

const metadataAddresses = new Set([
  "169.254.169.254",
  "169.254.169.253",
  "169.254.169.250",
  "fd00:ec2::254",
]);

export function parseIpAddress(
  value: string,
): ipaddr.IPv4 | ipaddr.IPv6 | null {
  try {
    return ipaddr.process(value);
  } catch {
    try {
      return ipaddr.parse(value);
    } catch {
      return null;
    }
  }
}

export function isBlockedIpAddress(value: string): boolean {
  const address = parseIpAddress(value);
  // Fail closed: an address we cannot classify must not be treated as public.
  if (!address) return true;

  const canonical = address.toString();
  if (metadataAddresses.has(canonical)) return true;
  if (address.kind() === "ipv4" && canonical.startsWith("169.254.169.")) {
    return true;
  }

  const range = address.range();
  if (range !== publicUnicastRange) return true;
  return blockedRanges.has(range);
}

export function isLiteralIpHostname(hostname: string): boolean {
  return parseIpAddress(hostname) !== null;
}
