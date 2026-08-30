import type { Soft404SignalCode } from "@/server/monitoring/soft404/types";
import { SOFT404_SIGNAL_CODES } from "@/server/monitoring/soft404/types";

const SIGNAL_LABELS: Record<Soft404SignalCode, string> = {
  TITLE_NOT_FOUND: "Page title contains a not-found phrase",
  H1_NOT_FOUND: "Main heading contains a not-found phrase",
  H2_NOT_FOUND: "Subheading contains a not-found phrase",
  BODY_NOT_FOUND_PHRASE: "Page text contains a not-found phrase",
  TITLE_404: 'Page title contains "404"',
  H1_404: 'Main heading contains "404"',
  LOW_CONTENT: "Page contains very little normal content",
  NOINDEX: "Page asks search engines not to index it",
  CANONICAL_HOME: "Canonical URL points at the homepage",
  TEMPLATE_ERROR: "Page uses a generic error-template phrase",
};

export function isSoft404SignalCode(value: string): value is Soft404SignalCode {
  return (SOFT404_SIGNAL_CODES as readonly string[]).includes(value);
}

export function formatSoft404Signal(code: string): string | null {
  if (!isSoft404SignalCode(code)) return null;
  return SIGNAL_LABELS[code];
}

export function parseStoredSoft404Signals(value: unknown): Soft404SignalCode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Soft404SignalCode =>
      typeof entry === "string" && isSoft404SignalCode(entry),
  );
}

export function soft404ConfidenceLabel(score: number): string {
  if (score >= 90) return "High confidence";
  if (score >= 80) return "Confirmed";
  if (score >= 50) return "Possible";
  return "Unlikely";
}
