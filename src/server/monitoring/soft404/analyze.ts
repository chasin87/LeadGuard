import { createLogger } from "@/server/logger";
import { SOFT404_CLASSIFIER_VERSION } from "@/server/monitoring/soft404/config";
import { isAnalyzableContentType } from "@/server/monitoring/soft404/content-type";
import {
  decodeHttpBody,
  decompressHttpBody,
} from "@/server/monitoring/soft404/decode";
import { extractPage } from "@/server/monitoring/soft404/extract";
import { scoreExtractedPage } from "@/server/monitoring/soft404/score";
import type {
  Soft404AnalysisInput,
  Soft404AnalysisResult,
} from "@/server/monitoring/soft404/types";

const logger = createLogger("soft404");

function skipped(
  reason: NonNullable<Soft404AnalysisResult["skipReason"]>,
): Soft404AnalysisResult {
  return {
    classification: "NOT_SOFT_404",
    score: 0,
    signals: [],
    classifierVersion: SOFT404_CLASSIFIER_VERSION,
    analyzed: false,
    skipReason: reason,
  };
}

export function analyzeSoft404(
  input: Soft404AnalysisInput,
  encoding: string | null = null,
): Soft404AnalysisResult {
  if (input.httpStatus < 200 || input.httpStatus > 299) {
    return skipped("ineligible_status");
  }
  if (!isAnalyzableContentType(input.contentType, input.body)) {
    return skipped("ineligible_content_type");
  }
  if (input.body.length === 0) {
    return skipped("empty_body");
  }

  try {
    const decompressed = decompressHttpBody(input.body, encoding);
    const html = decodeHttpBody(decompressed, input.contentType);
    const page = extractPage(html);
    const scored = scoreExtractedPage(page, input.finalUrl);
    logger.debug("soft404.analysis.completed", {
      score: scored.score,
      classifierVersion: SOFT404_CLASSIFIER_VERSION,
      classification: scored.classification,
    });
    if (scored.classification === "SOFT_404") {
      logger.info("soft404.detected", {
        score: scored.score,
        classifierVersion: SOFT404_CLASSIFIER_VERSION,
      });
    }
    return {
      classification: scored.classification,
      score: scored.score,
      signals: scored.signals,
      classifierVersion: SOFT404_CLASSIFIER_VERSION,
      analyzed: true,
      skipReason: null,
    };
  } catch {
    logger.warn("soft404.analysis.failed", {
      classifierVersion: SOFT404_CLASSIFIER_VERSION,
    });
    return skipped("analyzer_error");
  }
}

export type HeuristicSoft404Classifier = {
  version: string;
  analyze: typeof analyzeSoft404;
};

export function createHeuristicSoft404Classifier(): HeuristicSoft404Classifier {
  return {
    version: SOFT404_CLASSIFIER_VERSION,
    analyze: analyzeSoft404,
  };
}
