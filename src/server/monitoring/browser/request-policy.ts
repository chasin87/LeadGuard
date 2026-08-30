import { parseHttpUrlInput } from "@/lib/urls/normalize-url";
import { UrlValidationError } from "@/server/security/errors";
import {
  isBlockedIpAddress,
  isLiteralIpHostname,
} from "@/server/security/ip-classification";
import {
  assertPublicHttpTarget,
  type DnsResolver,
} from "@/server/security/ssrf";
import { isTrackingRequest } from "@/server/monitoring/browser/tracking-blocklist";

export type BrowserRequestDecision =
  | "allow"
  | "block-ssrf"
  | "block-scheme"
  | "block-tracking"
  | "block-media"
  | "block-size";

export type BrowserRequestPolicyOptions = {
  resolver?: DnsResolver;
  /**
   * Test-only: allow loopback so Playwright can hit local fixtures.
   * Production never sets this. SSRF for metadata/RFC1918 remains active.
   */
  allowPrivateLoopbackForTests?: boolean;
  hostnameDecisionCache?: Map<string, BrowserRequestDecision>;
};

const allowedInternalSchemes = new Set(["about", "blob", "data"]);
const blockedSchemes = new Set([
  "file",
  "ftp",
  "ws",
  "wss",
  "chrome",
  "chrome-extension",
  "chrome-untrusted",
  "devtools",
  "javascript",
  "gopher",
  "smb",
  "ssh",
]);
const blockedMediaTypes = new Set(["media", "websocket"]);

export async function evaluateBrowserRequest(
  rawUrl: string,
  resourceType: string,
  options: BrowserRequestPolicyOptions = {},
): Promise<BrowserRequestDecision> {
  if (blockedMediaTypes.has(resourceType)) {
    return "block-media";
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "block-scheme";
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (allowedInternalSchemes.has(scheme)) {
    return "allow";
  }
  if (blockedSchemes.has(scheme) || (scheme !== "http" && scheme !== "https")) {
    return "block-scheme";
  }

  if (isTrackingRequest(parsed)) {
    return "block-tracking";
  }

  if (options.allowPrivateLoopbackForTests && isLoopbackUrl(parsed)) {
    return "allow";
  }

  const cacheKey = parsed.hostname.toLowerCase();
  const cached = options.hostnameDecisionCache?.get(cacheKey);
  if (cached && cached !== "allow") return cached;
  if (cached === "allow") {
    // Hostname was public; still allow this path on the same host.
    return "allow";
  }

  try {
    await assertPublicHttpTarget(parsed.href, {
      resolver: options.resolver,
      originOnly: false,
    });
    options.hostnameDecisionCache?.set(cacheKey, "allow");
    return "allow";
  } catch (error) {
    if (error instanceof UrlValidationError) {
      const decision: BrowserRequestDecision = "block-ssrf";
      options.hostnameDecisionCache?.set(cacheKey, decision);
      return decision;
    }
    try {
      parseHttpUrlInput(parsed.href, { originOnly: false });
    } catch {
      return "block-scheme";
    }
    return "block-ssrf";
  }
}

export function isLoopbackUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  if (isLiteralIpHostname(host) && isBlockedIpAddress(host)) {
    // Only treat loopback as test fixture, not RFC1918 or metadata.
    return host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
  }
  return false;
}

export function isSsrfDecision(decision: BrowserRequestDecision): boolean {
  return decision === "block-ssrf" || decision === "block-scheme";
}
