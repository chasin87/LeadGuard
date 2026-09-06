export const clickIdMaxLength = 512;
export const clickIdParamNames = ["gclid", "gbraid", "wbraid"] as const;

export type GoogleClickIds = {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
};

const printableAscii = /^[\u0021-\u007E]+$/;

export function isValidClickId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= clickIdMaxLength &&
    printableAscii.test(value) &&
    !value.includes(" ")
  );
}

export function parseClickId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!isValidClickId(value)) return null;
  return value;
}

export function extractClickIdsFromSearchParams(
  params: URLSearchParams,
): GoogleClickIds {
  return {
    gclid: parseClickId(params.get("gclid")),
    gbraid: parseClickId(params.get("gbraid")),
    wbraid: parseClickId(params.get("wbraid")),
  };
}

export function extractClickIdsFromUrl(url: string): GoogleClickIds {
  try {
    return extractClickIdsFromSearchParams(new URL(url).searchParams);
  } catch {
    return { gclid: null, gbraid: null, wbraid: null };
  }
}

export function hasAnyClickId(ids: GoogleClickIds): boolean {
  return Boolean(ids.gclid || ids.gbraid || ids.wbraid);
}

export function clickIdPresence(ids: GoogleClickIds) {
  return {
    hasGclid: Boolean(ids.gclid),
    hasGbraid: Boolean(ids.gbraid),
    hasWbraid: Boolean(ids.wbraid),
  };
}
