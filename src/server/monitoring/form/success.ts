const maxPatternLength = 200;
const globSpecial = /[.+?^${}()|[\]\\]/g;

export function matchSuccessUrl(finalUrl: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length > maxPatternLength) return false;
  let parsed: URL;
  try {
    parsed = new URL(finalUrl);
  } catch {
    return false;
  }
  const pathname = parsed.pathname || "/";
  const candidate = trimmed.includes("://")
    ? `${parsed.origin}${pathname}`
    : pathname;

  if (!trimmed.includes("*")) {
    if (trimmed.includes("://")) {
      return candidate === trimmed || candidate.startsWith(`${trimmed}/`);
    }
    const pathPattern = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return pathname === pathPattern || pathname.startsWith(`${pathPattern}/`);
  }

  const source = trimmed.includes("://") ? candidate : pathname;
  const escaped = trimmed.replace(globSpecial, "\\$&").replaceAll("*", ".*");
  try {
    return new RegExp(`^${escaped}$`, "i").test(source);
  } catch {
    return false;
  }
}

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function visibleTextContains(haystack: string, needle: string): boolean {
  const target = normalizeVisibleText(needle);
  if (!target) return false;
  return normalizeVisibleText(haystack).includes(target);
}
