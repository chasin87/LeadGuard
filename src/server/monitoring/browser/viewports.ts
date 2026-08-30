import type { BrowserViewport } from "@/generated/prisma/enums";

export type BrowserViewportPreset = {
  viewport: BrowserViewport;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
};

const desktopUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 LeadGuardBrowser/1.0";

const mobileUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 LeadGuardBrowser/1.0";

export const browserViewportPresets: Record<
  BrowserViewport,
  BrowserViewportPreset
> = {
  DESKTOP: {
    viewport: "DESKTOP",
    width: 1440,
    height: 900,
    isMobile: false,
    hasTouch: false,
    userAgent: desktopUserAgent,
  },
  MOBILE: {
    viewport: "MOBILE",
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    userAgent: mobileUserAgent,
  },
};

export function getBrowserViewportPreset(
  viewport: BrowserViewport,
): BrowserViewportPreset {
  return browserViewportPresets[viewport];
}
