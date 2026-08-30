export type MonitorHealth =
  | "pending"
  | "pending_confirmation"
  | "operational"
  | "degraded"
  | "failing"
  | "down";

export type WebsiteHealth = MonitorHealth;

export function deriveMonitorHealth(input: {
  latestCheck: { status: "SUCCESS" | "DEGRADED" | "FAILURE" } | null;
  hasOpenIncident: boolean;
  receiptStatus?: "PENDING" | "RECEIVED" | "TIMED_OUT" | "FAILED" | null;
}): MonitorHealth {
  if (input.hasOpenIncident) return "down";
  if (!input.latestCheck) return "pending";
  if (input.receiptStatus === "PENDING") return "pending_confirmation";
  if (input.latestCheck.status === "SUCCESS") return "operational";
  if (input.latestCheck.status === "DEGRADED") return "degraded";
  return "failing";
}

export function deriveWebsiteHealth(
  monitorHealths: readonly MonitorHealth[],
): WebsiteHealth {
  if (monitorHealths.length === 0) return "pending";
  if (monitorHealths.some((health) => health === "down")) return "down";
  if (monitorHealths.some((health) => health === "failing")) return "failing";
  if (monitorHealths.some((health) => health === "degraded")) return "degraded";
  if (monitorHealths.some((health) => health === "pending_confirmation")) {
    return "pending_confirmation";
  }
  if (monitorHealths.some((health) => health === "operational")) {
    return "operational";
  }
  return "pending";
}
