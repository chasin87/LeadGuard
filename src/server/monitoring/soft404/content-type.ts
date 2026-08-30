const ANALYZABLE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

export type ParsedContentType = {
  mediaType: string;
  charset: string | null;
};

export function parseContentTypeHeader(
  header: string | null | undefined,
): ParsedContentType | null {
  if (!header) return null;
  const [rawType, ...params] = header.split(";").map((part) => part.trim());
  if (!rawType) return null;
  const mediaType = rawType.toLowerCase();
  let charset: string | null = null;
  for (const param of params) {
    const [key, value] = param.split("=").map((part) => part.trim());
    if (key?.toLowerCase() === "charset" && value) {
      charset = value.replace(/^["']|["']$/g, "").toLowerCase();
    }
  }
  return { mediaType, charset };
}

function looksLikeHtml(body: Buffer): boolean {
  const prefix = body.subarray(0, 512).toString("latin1").trimStart();
  return /^(?:<!doctype\s+html|<html|<head|<title|<body)/i.test(prefix);
}

export function isAnalyzableContentType(
  contentType: string | null | undefined,
  body: Buffer,
): boolean {
  const parsed = parseContentTypeHeader(contentType);
  if (!parsed) return looksLikeHtml(body);
  if (ANALYZABLE_TYPES.has(parsed.mediaType)) return true;
  if (parsed.mediaType === "application/xml" && looksLikeHtml(body)) {
    return true;
  }
  return false;
}
