export const SOFT404_CLASSIFIER_VERSION = "v1";

export const SOFT404_MAX_BODY_BYTES = 128 * 1024;
export const SOFT404_MAX_TEXT_CHARS = 8_000;

export const SOFT404_SOFT_THRESHOLD = 80;
export const SOFT404_POSSIBLE_THRESHOLD = 50;

export const SOFT404_WEIGHTS = {
  titleStrongPhrase: 50,
  h1StrongPhrase: 50,
  h2StrongPhrase: 20,
  bodyStrongPhrase: 25,
  titleBare404: 10,
  h1Bare404: 15,
  lowContent: 30,
  noindex: 5,
  canonicalHome: 5,
  templateWeak: 8,
} as const;

export const SOFT404_LOW_CONTENT_CHARS = 280;
export const SOFT404_SUBSTANTIAL_CONTENT_CHARS = 1_200;
export const SOFT404_SUBSTANTIAL_CONTENT_CAP = 40;
export const SOFT404_ARTICLE_SCORE_CAP = 35;
