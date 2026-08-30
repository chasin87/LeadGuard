import { describe, expect, it } from "vitest";
import { classifyBrowserCheck, detectBlankPage } from "./classify";

const healthy = {
  unsafeMainDocument: false,
  navigationTimeout: false,
  navigationError: false,
  browserCrash: false,
  pageCrash: false,
  invalidSelector: false,
  mainHttpStatus: 200,
  renderedSoft404: false,
  requiredElementMissing: false,
  blankPage: false,
  severeJavascriptFailure: false,
  totalDurationMs: 1200,
  degradedLatencyMs: 10_000,
};

describe("browser classification", () => {
  it("classifies a normal rendered page as success", () => {
    expect(classifyBrowserCheck(healthy)).toMatchObject({
      status: "SUCCESS",
      errorType: null,
    });
  });

  it("marks a blank page as CONTENT_NOT_RENDERED", () => {
    expect(classifyBrowserCheck({ ...healthy, blankPage: true })).toMatchObject(
      {
        status: "FAILURE",
        errorType: "CONTENT_NOT_RENDERED",
      },
    );
  });

  it("fails when the required element is missing", () => {
    expect(
      classifyBrowserCheck({ ...healthy, requiredElementMissing: true }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "REQUIRED_ELEMENT_MISSING",
    });
  });

  it("prefers rendered soft-404 over a missing required element", () => {
    expect(
      classifyBrowserCheck({
        ...healthy,
        renderedSoft404: true,
        requiredElementMissing: true,
      }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "SOFT_404",
    });
  });

  it("prefers required-element failure over JavaScript noise and slowness", () => {
    expect(
      classifyBrowserCheck({
        ...healthy,
        requiredElementMissing: true,
        severeJavascriptFailure: false,
        totalDurationMs: 12_000,
      }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "REQUIRED_ELEMENT_MISSING",
    });
  });

  it("treats an invalid selector as configuration, not an outage class", () => {
    expect(
      classifyBrowserCheck({ ...healthy, invalidSelector: true }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "INVALID_MONITOR_CONFIGURATION",
    });
  });

  it("classifies navigation timeout before later page signals", () => {
    expect(
      classifyBrowserCheck({
        ...healthy,
        navigationTimeout: true,
        requiredElementMissing: true,
      }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "BROWSER_TIMEOUT",
    });
  });

  it("classifies page crash before missing elements", () => {
    expect(
      classifyBrowserCheck({
        ...healthy,
        pageCrash: true,
        requiredElementMissing: true,
      }),
    ).toMatchObject({
      status: "FAILURE",
      errorType: "PAGE_CRASH",
    });
  });

  it("marks slow but successful renders as degraded", () => {
    expect(
      classifyBrowserCheck({ ...healthy, totalDurationMs: 12_500 }),
    ).toMatchObject({
      status: "DEGRADED",
      errorType: null,
    });
  });

  it("detects blank pages conservatively", () => {
    expect(
      detectBlankPage({
        renderedTextLength: 4,
        visibleElementCount: 1,
        bodyHeight: 10,
        pageErrorCount: 1,
      }),
    ).toBe(true);
    expect(
      detectBlankPage({
        renderedTextLength: 80,
        visibleElementCount: 12,
        bodyHeight: 900,
        pageErrorCount: 2,
      }),
    ).toBe(false);
  });
});
