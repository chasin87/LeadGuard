const reservedSlugs = new Set([
  "app",
  "api",
  "auth",
  "dashboard",
  "health",
  "login",
  "new",
  "onboarding",
  "organizations",
  "register",
  "settings",
  "www",
]);

const maxSlugLength = 48;

export function slugifyOrganizationName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxSlugLength)
    .replace(/-+$/g, "");

  if (!slug || reservedSlugs.has(slug)) {
    return "organization";
  }

  return slug;
}

export function isReservedOrganizationSlug(slug: string): boolean {
  return reservedSlugs.has(slug);
}

export function nextSlugCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base.slice(0, maxSlugLength);

  const suffix = `-${attempt + 1}`;
  return `${base.slice(0, maxSlugLength - suffix.length)}${suffix}`;
}

export function randomSlugSuffix(base: string): string {
  const suffix = `-${Math.random().toString(36).slice(2, 8)}`;
  return `${base.slice(0, maxSlugLength - suffix.length)}${suffix}`;
}
