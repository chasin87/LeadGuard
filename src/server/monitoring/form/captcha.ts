import type { Page } from "playwright-core";

const captchaSelectors = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "[data-sitekey]",
  "#cf-challenge-running",
];

export async function detectCaptcha(page: Page): Promise<boolean> {
  for (const selector of captchaSelectors) {
    const count = await page
      .locator(selector)
      .count()
      .catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}
