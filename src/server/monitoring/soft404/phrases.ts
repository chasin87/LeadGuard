export const STRONG_NOT_FOUND_PHRASES = [
  "page not found",
  "404 not found",
  "we couldn't find this page",
  "we could not find this page",
  "we couldn't find that page",
  "we could not find that page",
  "this page doesn't exist",
  "this page does not exist",
  "the page you are looking for cannot be found",
  "the page you are looking for does not exist",
  "sorry, this page is unavailable",
  "sorry, the page you are looking for",
  "couldn't find that page",
  "could not find that page",
  "pagina niet gevonden",
  "deze pagina bestaat niet",
  "deze pagina bestaat niet meer",
  "we konden deze pagina niet vinden",
  "we kunnen deze pagina niet vinden",
  "de opgevraagde pagina bestaat niet",
  "pagina bestaat niet meer",
  "helaas, deze pagina kunnen we niet vinden",
  "de pagina die je zoekt bestaat niet",
  "de pagina die je zoekt bestaat niet meer",
] as const;

export const WEAK_TEMPLATE_PHRASES = [
  "oops!",
  "oops",
  "something went wrong",
  "nothing here",
  "lost?",
  "whoops",
] as const;

export function normalizeAnalysisText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function containsPhrase(
  haystack: string,
  phrases: readonly string[],
): boolean {
  const normalized = normalizeAnalysisText(haystack);
  if (!normalized) return false;
  return phrases.some((phrase) => normalized.includes(phrase));
}

export function hasBare404(text: string): boolean {
  const normalized = normalizeAnalysisText(text);
  return /(?:^|[\s(\[{])404(?:$|[\s)\]}.,;:!?/\-–—])/.test(normalized);
}

export function looksLikeProduct404(text: string): boolean {
  const normalized = normalizeAnalysisText(text);
  return /(?:product|model|edition|serie|series|artikelnummer)\s*404|404\s*(?:pro|plus|max|mini)/.test(
    normalized,
  );
}

export function looksLikeArticle404(text: string): boolean {
  const normalized = normalizeAnalysisText(text);
  return /http\s*404|status\s*code\s*404|statuscode\s*404|foutcode\s*404|wat betekent|what (?:is|does)|error code 404/.test(
    normalized,
  );
}
