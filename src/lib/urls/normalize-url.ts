import { UrlValidationError } from "@/server/security/errors";

export const allowedWebsiteSchemes = ["http", "https"] as const;
export type WebsiteScheme = (typeof allowedWebsiteSchemes)[number];

export type NormalizedWebsiteOrigin = {
  href: string;
  normalizedUrl: string;
  hostname: string;
  scheme: WebsiteScheme;
  port: number;
};

export type NormalizedHttpUrl = {
  href: string;
  normalizedUrl: string;
  origin: string;
  hostname: string;
  scheme: WebsiteScheme;
  port: number;
  pathname: string;
  search: string;
};

const allowedPorts: Record<WebsiteScheme, number> = {
  http: 80,
  https: 443,
};

const blockedHostnameSuffixes = [
  ".local",
  ".internal",
  ".localhost",
  ".intranet",
  ".corp",
  ".lan",
  ".home",
];

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function hasExplicitScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function isBlockedInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (blockedHostnames.has(host)) return true;
  return blockedHostnameSuffixes.some((suffix) => host.endsWith(suffix));
}

export function parseHttpUrlInput(
  input: string,
  options: { originOnly?: boolean } = {},
): NormalizedHttpUrl {
  const originOnly = options.originOnly ?? false;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new UrlValidationError(
      "Enter a valid public website URL.",
      "invalid_url",
    );
  }

  const candidate = hasExplicitScheme(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new UrlValidationError(
      "Enter a valid public website URL.",
      "invalid_url",
    );
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new UrlValidationError(
      "Only HTTP and HTTPS websites are supported.",
      "unsupported_scheme",
    );
  }

  if (parsed.username || parsed.password) {
    throw new UrlValidationError(
      "Website URLs cannot include usernames or passwords.",
      "credentials_not_allowed",
    );
  }

  if (parsed.hash) {
    throw new UrlValidationError(
      originOnly
        ? "Add the website origin only. Specific pages can be monitored in a later step."
        : "Monitor URLs cannot include a fragment.",
      originOnly ? "origin_only" : "invalid_url",
    );
  }

  if (
    originOnly &&
    (parsed.search || (parsed.pathname && parsed.pathname !== "/"))
  ) {
    throw new UrlValidationError(
      "Add the website origin only. Specific pages can be monitored in a later step.",
      "origin_only",
    );
  }

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!hostname) {
    throw new UrlValidationError(
      "Enter a valid public website URL.",
      "invalid_url",
    );
  }

  if (isBlockedInternalHostname(hostname)) {
    throw new UrlValidationError(
      "Private and internal network addresses cannot be monitored.",
      "internal_hostname",
    );
  }

  const isIpv6 = hostname.includes(":");
  if (!isIpv6 && !hostname.includes(".") && !/^\d/.test(hostname)) {
    throw new UrlValidationError(
      "Enter a valid public website URL.",
      "invalid_url",
    );
  }

  const defaultPort = allowedPorts[scheme];
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  if (!Number.isInteger(port) || port !== defaultPort) {
    throw new UrlValidationError(
      "Only the default HTTP (80) and HTTPS (443) ports are supported.",
      "port_not_allowed",
    );
  }

  const hostForUrl = isIpv6 ? `[${hostname}]` : hostname;
  const origin = `${scheme}://${hostForUrl}`;
  const pathname = parsed.pathname || "/";
  const search = parsed.search;
  const normalizedUrl = originOnly ? origin : `${origin}${pathname}${search}`;

  return {
    href: normalizedUrl,
    normalizedUrl,
    origin,
    hostname,
    scheme,
    port,
    pathname,
    search,
  };
}

export function parseWebsiteOriginInput(
  input: string,
): NormalizedWebsiteOrigin {
  const parsed = parseHttpUrlInput(input, { originOnly: true });
  return {
    href: parsed.origin,
    normalizedUrl: parsed.origin,
    hostname: parsed.hostname,
    scheme: parsed.scheme,
    port: parsed.port,
  };
}

export function suggestedWebsiteName(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

export function isSameWebsiteOrigin(
  website: { scheme: string; hostname: string; port: number },
  url: Pick<NormalizedHttpUrl, "scheme" | "hostname" | "port">,
): boolean {
  return (
    website.scheme === url.scheme &&
    website.hostname === url.hostname &&
    website.port === url.port
  );
}

export function resolveMonitorUrlAgainstWebsite(
  input: string,
  websiteOrigin: string,
): NormalizedHttpUrl {
  const trimmed = input.trim();
  if (trimmed.startsWith("/")) {
    return parseHttpUrlInput(new URL(trimmed, `${websiteOrigin}/`).href);
  }
  return parseHttpUrlInput(trimmed);
}
