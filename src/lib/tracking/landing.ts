const utmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type SanitizedLanding = {
  origin: string | null;
  pathname: string | null;
};

export type UtmParameters = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

const utmMaxLength = 200;

export function sanitizeLandingUrl(
  url: string | null | undefined,
): SanitizedLanding {
  if (!url) return { origin: null, pathname: null };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { origin: null, pathname: null };
    }
    return {
      origin: parsed.origin,
      pathname: parsed.pathname || "/",
    };
  } catch {
    return { origin: null, pathname: null };
  }
}

export function sanitizePathname(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.length > 2048 || /[\u0000-\u001F]/.test(value)) return null;
  return value.slice(0, 2048);
}

export function sanitizeReferrerDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = value.includes("://")
      ? new URL(value)
      : new URL(`https://${value}`);
    const host = parsed.hostname.toLowerCase();
    if (!host || host.length > 253) return null;
    return host;
  } catch {
    return null;
  }
}

export function parseUtm(params: URLSearchParams): UtmParameters {
  const values = Object.fromEntries(
    utmKeys.map((key) => {
      const raw = params.get(key);
      if (!raw || raw.length > utmMaxLength || /[\u0000-\u001F]/.test(raw)) {
        return [key, null] as const;
      }
      return [key, raw] as const;
    }),
  );
  return {
    utmSource: values.utm_source ?? null,
    utmMedium: values.utm_medium ?? null,
    utmCampaign: values.utm_campaign ?? null,
    utmContent: values.utm_content ?? null,
    utmTerm: values.utm_term ?? null,
  };
}

export function parseUtmFromUnknown(value: unknown): UtmParameters {
  const empty: UtmParameters = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
  };
  if (!value || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  const read = (key: string) => {
    const raw = record[key];
    if (typeof raw !== "string" || !raw || raw.length > utmMaxLength)
      return null;
    if (/[\u0000-\u001F]/.test(raw)) return null;
    return raw;
  };
  return {
    utmSource: read("utmSource") ?? read("utm_source"),
    utmMedium: read("utmMedium") ?? read("utm_medium"),
    utmCampaign: read("utmCampaign") ?? read("utm_campaign"),
    utmContent: read("utmContent") ?? read("utm_content"),
    utmTerm: read("utmTerm") ?? read("utm_term"),
  };
}
