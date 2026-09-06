export function parseOriginHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function wwwVariant(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : `www.${hostname}`;
}

export function originsMatchWebsite(input: {
  requestOrigin: string | null;
  websiteOrigin: string;
}): boolean {
  if (!input.requestOrigin) return false;
  let request: URL;
  let website: URL;
  try {
    request = new URL(input.requestOrigin);
    website = new URL(input.websiteOrigin);
  } catch {
    return false;
  }
  if (request.protocol !== website.protocol) return false;
  const requestPort =
    request.port || (request.protocol === "https:" ? "443" : "80");
  const websitePort =
    website.port || (website.protocol === "https:" ? "443" : "80");
  if (requestPort !== websitePort) return false;
  const host = request.hostname.toLowerCase();
  const allowed = website.hostname.toLowerCase();
  return host === allowed || host === wwwVariant(allowed);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
