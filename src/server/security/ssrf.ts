import { promises as dns } from "node:dns";
import { parseHttpUrlInput } from "@/lib/urls/normalize-url";
import { UrlValidationError } from "@/server/security/errors";
import {
  isBlockedIpAddress,
  isLiteralIpHostname,
} from "@/server/security/ip-classification";

export type DnsResolver = (hostname: string) => Promise<string[]>;

export type SafeOutboundTarget = {
  normalizedUrl: string;
  hostname: string;
  scheme: "http" | "https";
  port: number;
  resolvedAddresses: string[];
  dnsStatus: "RESOLVED" | "UNRESOLVED";
};

export type ResolveSafeTargetOptions = {
  resolver?: DnsResolver;
  originOnly?: boolean;
  /**
   * When true, DNS must succeed and every address must be public.
   * Workers must use this before every outbound request.
   */
  requireResolved?: boolean;
};

export async function defaultDnsResolver(hostname: string): Promise<string[]> {
  const addresses = new Set<string>();

  const lookedUp = await dns
    .lookup(hostname, { all: true, verbatim: true })
    .catch(() => [] as Array<{ address: string }>);
  for (const record of lookedUp) {
    addresses.add(record.address);
  }

  const ipv4 = await dns.resolve4(hostname).catch(() => [] as string[]);
  const ipv6 = await dns.resolve6(hostname).catch(() => [] as string[]);
  for (const address of ipv4) addresses.add(address);
  for (const address of ipv6) addresses.add(address);

  return [...addresses];
}

function assertPublicAddresses(hostname: string, addresses: string[]): void {
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new UrlValidationError(
        "Private and internal network addresses cannot be monitored.",
        "private_target",
      );
    }
  }

  if (isLiteralIpHostname(hostname) && isBlockedIpAddress(hostname)) {
    throw new UrlValidationError(
      "Private and internal network addresses cannot be monitored.",
      "private_target",
    );
  }
}

/**
 * Parse, normalize, and classify a user-controlled URL.
 *
 * Website creation may allow unresolved public hostnames.
 * Workers in later phases must call this again with `requireResolved: true`
 * immediately before each outbound request, and again for every redirect.
 */
export async function resolveSafeOutboundTarget(
  input: string,
  options: ResolveSafeTargetOptions = {},
): Promise<SafeOutboundTarget> {
  const origin = parseHttpUrlInput(input, {
    originOnly: options.originOnly ?? true,
  });
  const resolver = options.resolver ?? defaultDnsResolver;

  if (isLiteralIpHostname(origin.hostname)) {
    assertPublicAddresses(origin.hostname, [origin.hostname]);
    return {
      normalizedUrl: origin.normalizedUrl,
      hostname: origin.hostname,
      scheme: origin.scheme,
      port: origin.port,
      resolvedAddresses: [origin.hostname],
      dnsStatus: "RESOLVED",
    };
  }

  let resolvedAddresses: string[] = [];
  try {
    resolvedAddresses = await resolver(origin.hostname);
  } catch {
    resolvedAddresses = [];
  }

  if (resolvedAddresses.length > 0) {
    assertPublicAddresses(origin.hostname, resolvedAddresses);
    return {
      normalizedUrl: origin.normalizedUrl,
      hostname: origin.hostname,
      scheme: origin.scheme,
      port: origin.port,
      resolvedAddresses,
      dnsStatus: "RESOLVED",
    };
  }

  if (options.requireResolved) {
    throw new UrlValidationError(
      "This website hostname could not be resolved to a public address.",
      "dns_failed",
    );
  }

  return {
    normalizedUrl: origin.normalizedUrl,
    hostname: origin.hostname,
    scheme: origin.scheme,
    port: origin.port,
    resolvedAddresses: [],
    dnsStatus: "UNRESOLVED",
  };
}

/** Worker contract: fail closed unless the target is public and currently resolved. */
export async function assertPublicHttpTarget(
  input: string,
  options: Omit<ResolveSafeTargetOptions, "requireResolved"> = {},
): Promise<SafeOutboundTarget> {
  return resolveSafeOutboundTarget(input, {
    originOnly: false,
    ...options,
    requireResolved: true,
  });
}
