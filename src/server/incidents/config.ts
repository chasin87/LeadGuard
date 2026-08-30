export const incidentThreshold = {
  min: 1,
  default: 2,
  max: 10,
} as const;

export type IncidentThreshold = number;

export function clampIncidentThreshold(value: number): number {
  if (!Number.isInteger(value)) return incidentThreshold.default;
  if (value < incidentThreshold.min) return incidentThreshold.min;
  if (value > incidentThreshold.max) return incidentThreshold.max;
  return value;
}
