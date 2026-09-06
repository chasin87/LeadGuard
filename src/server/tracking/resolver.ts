export type AttributionTouchSnapshot = {
  id: string;
  capturedAt: Date;
  expiresAt: Date;
  hasGclid: boolean;
  hasGbraid: boolean;
  hasWbraid: boolean;
  channel: "GOOGLE_ADS" | "OTHER_PAID" | "ORGANIC" | "DIRECT" | "UNKNOWN";
};

export type ResolvedLeadAttribution = {
  attributionStatus:
    "ATTRIBUTED" | "ORGANIC_OR_DIRECT" | "UNATTRIBUTED" | "EXPIRED";
  firstTouchId: string | null;
  primaryTouchId: string | null;
};

function isPaid(touch: AttributionTouchSnapshot): boolean {
  return (
    touch.channel === "GOOGLE_ADS" ||
    touch.hasGclid ||
    touch.hasGbraid ||
    touch.hasWbraid
  );
}

function isEligible(
  touch: AttributionTouchSnapshot,
  leadOccurredAt: Date,
  now: Date,
): boolean {
  if (touch.capturedAt.getTime() > leadOccurredAt.getTime()) return false;
  if (touch.expiresAt.getTime() <= leadOccurredAt.getTime()) return false;
  if (touch.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function resolveLeadAttribution(input: {
  leadOccurredAt: Date;
  now?: Date;
  touches: AttributionTouchSnapshot[];
}): ResolvedLeadAttribution {
  const now = input.now ?? input.leadOccurredAt;
  const chronological = [...input.touches].sort(
    (left, right) =>
      left.capturedAt.getTime() - right.capturedAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const eligible = chronological.filter((touch) =>
    isEligible(touch, input.leadOccurredAt, now),
  );
  if (eligible.length === 0) {
    const hadExpiredPaid = chronological.some(
      (touch) =>
        isPaid(touch) &&
        touch.capturedAt.getTime() <= input.leadOccurredAt.getTime(),
    );
    return {
      attributionStatus: hadExpiredPaid ? "EXPIRED" : "UNATTRIBUTED",
      firstTouchId: null,
      primaryTouchId: null,
    };
  }

  const firstTouch = eligible[0] ?? null;
  const paid = eligible.filter(isPaid);
  const primary = paid.at(-1) ?? null;
  if (primary) {
    return {
      attributionStatus: "ATTRIBUTED",
      firstTouchId: firstTouch?.id ?? null,
      primaryTouchId: primary.id,
    };
  }
  return {
    attributionStatus: "ORGANIC_OR_DIRECT",
    firstTouchId: firstTouch?.id ?? null,
    primaryTouchId: null,
  };
}
