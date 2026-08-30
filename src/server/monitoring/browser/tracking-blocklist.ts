/**
 * Known analytics/conversion endpoints. Functional CDNs are not listed.
 * Blocking these reduces accidental conversion and analytics pollution.
 */
const trackingHostSuffixes = [
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "doubleclick.net",
  "googlesyndication.com",
  "facebook.net",
  "facebook.com",
  "connect.facebook.net",
  "tiktok.com",
  "analytics.tiktok.com",
  "hotjar.com",
  "hotjar.io",
  "clarity.ms",
  "ads.linkedin.com",
  "snap.licdn.com",
  "ads-twitter.com",
  "analytics.twitter.com",
  "scorecardresearch.com",
  "quantserve.com",
  "adservice.google.com",
  "pagead2.googlesyndication.com",
] as const;

const trackingPathHints = [
  "/gtag/js",
  "/gtm.js",
  "/fbevents.js",
  "/tr?",
  "/en_US/fbevents.js",
];

export function isTrackingRequest(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (
    trackingHostSuffixes.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }
  const href = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  return trackingPathHints.some((hint) => href.includes(hint.replace("?", "")));
}

export const trackingBlocklistDescription = trackingHostSuffixes.join(", ");
