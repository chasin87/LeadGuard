export const SOFT404_SIGNAL_CODES = [
  "TITLE_NOT_FOUND",
  "H1_NOT_FOUND",
  "H2_NOT_FOUND",
  "BODY_NOT_FOUND_PHRASE",
  "TITLE_404",
  "H1_404",
  "LOW_CONTENT",
  "NOINDEX",
  "CANONICAL_HOME",
  "TEMPLATE_ERROR",
] as const;

export type Soft404SignalCode = (typeof SOFT404_SIGNAL_CODES)[number];

export type Soft404Classification =
  "NOT_SOFT_404" | "POSSIBLE_SOFT_404" | "SOFT_404";

export type Soft404SkipReason =
  | "ineligible_status"
  | "ineligible_content_type"
  | "empty_body"
  | "analyzer_error";

export type Soft404AnalysisResult = {
  classification: Soft404Classification;
  score: number;
  signals: Soft404SignalCode[];
  classifierVersion: string;
  analyzed: boolean;
  skipReason: Soft404SkipReason | null;
};

export type Soft404AnalysisInput = {
  httpStatus: number;
  contentType: string | null;
  body: Buffer;
  requestedUrl: string;
  finalUrl: string | null;
};

export type ExtractedPage = {
  title: string;
  h1: string[];
  h2: string[];
  bodyText: string;
  robots: string;
  canonical: string | null;
};
