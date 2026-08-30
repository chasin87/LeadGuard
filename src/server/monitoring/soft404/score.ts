import {
  SOFT404_ARTICLE_SCORE_CAP,
  SOFT404_LOW_CONTENT_CHARS,
  SOFT404_POSSIBLE_THRESHOLD,
  SOFT404_SOFT_THRESHOLD,
  SOFT404_SUBSTANTIAL_CONTENT_CAP,
  SOFT404_SUBSTANTIAL_CONTENT_CHARS,
  SOFT404_WEIGHTS,
} from "@/server/monitoring/soft404/config";
import {
  STRONG_NOT_FOUND_PHRASES,
  WEAK_TEMPLATE_PHRASES,
  containsPhrase,
  hasBare404,
  looksLikeArticle404,
  looksLikeProduct404,
} from "@/server/monitoring/soft404/phrases";
import type {
  ExtractedPage,
  Soft404Classification,
  Soft404SignalCode,
} from "@/server/monitoring/soft404/types";

export type ScoredSoft404 = {
  score: number;
  classification: Soft404Classification;
  signals: Soft404SignalCode[];
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function classify(
  score: number,
  hasStrongSignal: boolean,
): Soft404Classification {
  if (score >= SOFT404_SOFT_THRESHOLD && hasStrongSignal) return "SOFT_404";
  if (score >= SOFT404_POSSIBLE_THRESHOLD) return "POSSIBLE_SOFT_404";
  return "NOT_SOFT_404";
}

function isHomePath(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}

export function scoreExtractedPage(
  page: ExtractedPage,
  finalUrl: string | null,
): ScoredSoft404 {
  const signals: Soft404SignalCode[] = [];
  let score = 0;
  const heading = [...page.h1, ...page.h2].join(" ");
  const combined = `${page.title} ${heading} ${page.bodyText}`;
  const productLike =
    looksLikeProduct404(page.title) || page.h1.some(looksLikeProduct404);
  const articleLike =
    looksLikeArticle404(page.title) ||
    page.h1.some(looksLikeArticle404) ||
    looksLikeArticle404(combined.slice(0, 400));

  const titleStrong = containsPhrase(page.title, STRONG_NOT_FOUND_PHRASES);
  const h1Strong = page.h1.some((value) =>
    containsPhrase(value, STRONG_NOT_FOUND_PHRASES),
  );
  const h2Strong = page.h2.some((value) =>
    containsPhrase(value, STRONG_NOT_FOUND_PHRASES),
  );
  const bodyStrong = containsPhrase(page.bodyText, STRONG_NOT_FOUND_PHRASES);
  const hasStrongSignal = titleStrong || h1Strong || bodyStrong;

  if (titleStrong) {
    score += SOFT404_WEIGHTS.titleStrongPhrase;
    signals.push("TITLE_NOT_FOUND");
  }
  if (h1Strong) {
    score += SOFT404_WEIGHTS.h1StrongPhrase;
    signals.push("H1_NOT_FOUND");
  }
  if (h2Strong) {
    score += SOFT404_WEIGHTS.h2StrongPhrase;
    signals.push("H2_NOT_FOUND");
  }
  if (bodyStrong) {
    score += SOFT404_WEIGHTS.bodyStrongPhrase;
    signals.push("BODY_NOT_FOUND_PHRASE");
  }

  if (!productLike && !articleLike) {
    if (!titleStrong && hasBare404(page.title)) {
      score += SOFT404_WEIGHTS.titleBare404;
      signals.push("TITLE_404");
    }
    if (!h1Strong && page.h1.some(hasBare404)) {
      score += SOFT404_WEIGHTS.h1Bare404;
      signals.push("H1_404");
    }
  }

  const visibleLength =
    page.title.length + heading.length + page.bodyText.length;
  if (hasStrongSignal && visibleLength < SOFT404_LOW_CONTENT_CHARS) {
    score += SOFT404_WEIGHTS.lowContent;
    signals.push("LOW_CONTENT");
  }

  const templateWeak =
    containsPhrase(page.title, WEAK_TEMPLATE_PHRASES) ||
    page.h1.some((value) => containsPhrase(value, WEAK_TEMPLATE_PHRASES));
  if (templateWeak && (hasStrongSignal || signals.length > 0)) {
    score += SOFT404_WEIGHTS.templateWeak;
    signals.push("TEMPLATE_ERROR");
  }

  if (hasStrongSignal && page.robots.includes("noindex")) {
    score += SOFT404_WEIGHTS.noindex;
    signals.push("NOINDEX");
  }

  if (hasStrongSignal && page.canonical && finalUrl) {
    try {
      const final = new URL(finalUrl);
      const canonical = new URL(page.canonical, final);
      if (
        canonical.origin === final.origin &&
        isHomePath(canonical.pathname) &&
        !isHomePath(final.pathname)
      ) {
        score += SOFT404_WEIGHTS.canonicalHome;
        signals.push("CANONICAL_HOME");
      }
    } catch {
      // Invalid canonical URLs are ignored.
    }
  }

  if (articleLike && !titleStrong && !h1Strong) {
    score = Math.min(score, SOFT404_ARTICLE_SCORE_CAP);
  }
  if (
    !titleStrong &&
    !h1Strong &&
    page.bodyText.length >= SOFT404_SUBSTANTIAL_CONTENT_CHARS
  ) {
    score = Math.min(score, SOFT404_SUBSTANTIAL_CONTENT_CAP);
  }

  const clamped = clampScore(score);
  return {
    score: clamped,
    classification: classify(clamped, hasStrongSignal),
    signals,
  };
}
