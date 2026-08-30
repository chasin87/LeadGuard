import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSoft404 } from "@/server/monitoring/soft404/analyze";
import { SOFT404_CLASSIFIER_VERSION } from "@/server/monitoring/soft404/config";
import { extractPage } from "@/server/monitoring/soft404/extract";
import { scoreExtractedPage } from "@/server/monitoring/soft404/score";
import type { Soft404Classification } from "@/server/monitoring/soft404/types";

function fixture(name: string): Buffer {
  return readFileSync(path.join(process.cwd(), "tests/fixtures/soft404", name));
}

function analyzeHtml(
  html: string | Buffer,
  extras: { contentType?: string; httpStatus?: number; finalUrl?: string } = {},
) {
  return analyzeSoft404({
    httpStatus: extras.httpStatus ?? 200,
    contentType: extras.contentType ?? "text/html; charset=utf-8",
    body: typeof html === "string" ? Buffer.from(html) : html,
    requestedUrl: "https://example.com/old-campaign",
    finalUrl: extras.finalUrl ?? "https://example.com/old-campaign",
  });
}

describe("soft404 golden fixtures", () => {
  const cases: Array<{
    file: string;
    classification: Soft404Classification;
    minScore?: number;
    maxScore?: number;
  }> = [
    { file: "english-404.html", classification: "SOFT_404", minScore: 80 },
    { file: "dutch-404.html", classification: "SOFT_404", minScore: 80 },
    { file: "branded-404.html", classification: "SOFT_404", minScore: 80 },
    { file: "short-404.html", classification: "SOFT_404", minScore: 80 },
    { file: "entities-nbsp.html", classification: "SOFT_404", minScore: 80 },
    { file: "case-whitespace.html", classification: "SOFT_404", minScore: 80 },
    { file: "malformed.html", classification: "SOFT_404", minScore: 80 },
    { file: "homepage.html", classification: "NOT_SOFT_404", maxScore: 49 },
    {
      file: "article-http-404.html",
      classification: "NOT_SOFT_404",
      maxScore: 49,
    },
    { file: "product-404.html", classification: "NOT_SOFT_404", maxScore: 49 },
    { file: "footer-404.html", classification: "NOT_SOFT_404", maxScore: 49 },
    {
      file: "noindex-normal.html",
      classification: "NOT_SOFT_404",
      maxScore: 49,
    },
    {
      file: "borderline-oops.html",
      classification: "NOT_SOFT_404",
      maxScore: 79,
    },
  ];

  it.each(cases)(
    "$file → $classification",
    ({ file, classification, minScore, maxScore }) => {
      const result = analyzeHtml(fixture(file));
      expect(result.analyzed).toBe(true);
      expect(result.classifierVersion).toBe(SOFT404_CLASSIFIER_VERSION);
      expect(result.classification).toBe(classification);
      if (minScore != null)
        expect(result.score).toBeGreaterThanOrEqual(minScore);
      if (maxScore != null) expect(result.score).toBeLessThanOrEqual(maxScore);
    },
  );
});

describe("soft404 signal weights", () => {
  it("weights title phrases above a weak body mention", () => {
    const title = scoreExtractedPage(
      extractPage(
        "<title>Page not found</title><h1>Help</h1><p>Please try again.</p>",
      ),
      "https://example.com/missing",
    );
    const bodyOnly = scoreExtractedPage(
      extractPage(
        "<title>Support docs</title><h1>Support</h1><p>Lees ook ons artikel over foutcode 404.</p>".repeat(
          20,
        ),
      ),
      "https://example.com/docs",
    );
    expect(title.signals).toContain("TITLE_NOT_FOUND");
    expect(title.score).toBeGreaterThan(bodyOnly.score);
    expect(bodyOnly.classification).not.toBe("SOFT_404");
  });

  it("treats a strong h1 as a major signal", () => {
    const result = analyzeHtml(
      "<title>Acme</title><h1>Pagina niet gevonden</h1><p>Ga terug.</p>",
    );
    expect(result.signals).toContain("H1_NOT_FOUND");
    expect(result.classification).toBe("SOFT_404");
  });

  it("does not treat a lone 404 number as enough", () => {
    const result = analyzeHtml(
      "<title>Invoice 404</title><h1>Invoice 404</h1><p>Pay your open invoice.</p>",
    );
    expect(result.classification).toBe("NOT_SOFT_404");
  });

  it("boosts short error pages over long pages with an incidental phrase", () => {
    const shortPage = analyzeHtml(fixture("short-404.html"));
    const longPage = analyzeHtml(fixture("article-http-404.html"));
    expect(shortPage.score).toBeGreaterThan(longPage.score);
    expect(shortPage.signals).toContain("LOW_CONTENT");
  });
});

describe("soft404 eligibility", () => {
  it("skips HTTP 404 and 500 even if the HTML looks like a not-found page", () => {
    const html = fixture("english-404.html");
    expect(analyzeHtml(html, { httpStatus: 404 }).analyzed).toBe(false);
    expect(analyzeHtml(html, { httpStatus: 500 }).classification).toBe(
      "NOT_SOFT_404",
    );
  });

  it("skips JSON, PDF and images", () => {
    expect(
      analyzeHtml('{"error":"not found"}', {
        contentType: "application/json",
      }).analyzed,
    ).toBe(false);
    expect(
      analyzeHtml("%PDF-1.4", { contentType: "application/pdf" }).analyzed,
    ).toBe(false);
    expect(
      analyzeHtml(Buffer.from([0xff, 0xd8, 0xff]), {
        contentType: "image/jpeg",
      }).analyzed,
    ).toBe(false);
  });

  it("does not crash on huge HTML and stays bounded", () => {
    const prefix = "<title>Page not found</title><h1>Page not found</h1>";
    const huge = Buffer.concat([
      Buffer.from(prefix),
      Buffer.alloc(300_000, 97),
    ]);
    const result = analyzeHtml(huge);
    expect(result.classification).toBe("SOFT_404");
    expect(result.analyzed).toBe(true);
  });

  it("fails open on analyzer errors instead of throwing", () => {
    const result = analyzeSoft404({
      httpStatus: 200,
      contentType: "text/html",
      body: Buffer.from("<html>"),
      requestedUrl: "https://example.com/x",
      finalUrl: "https://example.com/x",
    });
    expect(result.classifierVersion).toBe(SOFT404_CLASSIFIER_VERSION);
  });
});

describe("soft404 performance", () => {
  it("analyzes 1000 fixtures without extreme CPU cost", () => {
    const html = fixture("english-404.html");
    const started = Date.now();
    for (let i = 0; i < 1000; i += 1) {
      analyzeHtml(html);
    }
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(3_000);
  });
});
