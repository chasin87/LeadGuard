import { describe, expect, it } from "vitest";
import { evaluateBrowserRequest } from "./request-policy";
import { validateCssSelector } from "./selector";

describe("browser request policy", () => {
  it("blocks loopback, metadata, and private IPv4/IPv6 literals", async () => {
    await expect(
      evaluateBrowserRequest("http://127.0.0.1/", "document"),
    ).resolves.toBe("block-ssrf");
    await expect(
      evaluateBrowserRequest(
        "http://169.254.169.254/latest/meta-data",
        "fetch",
      ),
    ).resolves.toBe("block-ssrf");
    await expect(
      evaluateBrowserRequest("http://10.0.0.1/admin", "xhr"),
    ).resolves.toBe("block-ssrf");
    await expect(
      evaluateBrowserRequest("http://[::1]/", "document"),
    ).resolves.toBe("block-ssrf");
  });

  it("blocks dangerous schemes", async () => {
    await expect(
      evaluateBrowserRequest("file:///etc/passwd", "document"),
    ).resolves.toBe("block-scheme");
    await expect(
      evaluateBrowserRequest("ftp://example.com/file", "document"),
    ).resolves.toBe("block-scheme");
    await expect(
      evaluateBrowserRequest("chrome://settings", "document"),
    ).resolves.toBe("block-scheme");
  });

  it("allows data and blob URLs used by the browser", async () => {
    await expect(
      evaluateBrowserRequest("data:text/plain,hello", "image"),
    ).resolves.toBe("allow");
    await expect(
      evaluateBrowserRequest("blob:https://example.com/123", "script"),
    ).resolves.toBe("allow");
  });

  it("blocks known tracking endpoints", async () => {
    await expect(
      evaluateBrowserRequest(
        "https://www.google-analytics.com/g/collect",
        "fetch",
      ),
    ).resolves.toBe("block-tracking");
    await expect(
      evaluateBrowserRequest(
        "https://connect.facebook.net/en_US/fbevents.js",
        "script",
      ),
    ).resolves.toBe("block-tracking");
  });

  it("allows loopback only when the test flag is set", async () => {
    await expect(
      evaluateBrowserRequest("http://127.0.0.1:43721/page", "document", {
        allowPrivateLoopbackForTests: true,
      }),
    ).resolves.toBe("allow");
    await expect(
      evaluateBrowserRequest("http://169.254.169.254/test", "image", {
        allowPrivateLoopbackForTests: true,
      }),
    ).resolves.toBe("block-ssrf");
  });

  it("blocks media resource types", async () => {
    await expect(
      evaluateBrowserRequest("https://cdn.example.com/video.mp4", "media"),
    ).resolves.toBe("block-media");
  });
});

describe("css selector validation", () => {
  it("accepts ordinary CSS selectors", () => {
    expect(validateCssSelector("#offerte-formulier").ok).toBe(true);
    expect(validateCssSelector('[data-leadguard="quote-form"]').ok).toBe(true);
    expect(validateCssSelector('a[href="/offerte"]').ok).toBe(true);
    expect(validateCssSelector('[data-slot="button"]').ok).toBe(true);
  });

  it("rejects incomplete or dangerous selectors", () => {
    expect(validateCssSelector("???").ok).toBe(false);
    expect(validateCssSelector("div[").ok).toBe(false);
    expect(validateCssSelector("<script>").ok).toBe(false);
    expect(validateCssSelector("xpath=//div").ok).toBe(false);
    expect(validateCssSelector('data-slot="button"').ok).toBe(false);
  });
});
