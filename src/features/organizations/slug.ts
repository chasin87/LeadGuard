const MAX_SLUG_LENGTH = 72;

export function slugifyOrganizationName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/g, "");
  return slug || "organisatie";
}

export function slugCandidate(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base.slice(0, MAX_SLUG_LENGTH - String(attempt + 1).length - 1)}-${attempt + 1}`;
}
