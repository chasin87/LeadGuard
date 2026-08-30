export function incidentDurationMs(
  startedAt: Date,
  resolvedAt: Date | null,
  now = new Date(),
): number {
  const end = resolvedAt ?? now;
  return Math.max(0, end.getTime() - startedAt.getTime());
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return totalSeconds === 1 ? "1 sec" : `${totalSeconds} sec`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return totalMinutes === 1 ? "1 min" : `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    if (minutes === 0) return hours === 1 ? "1 h" : `${hours} h`;
    return `${hours} h ${minutes} min`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) return days === 1 ? "1 d" : `${days} d`;
  return `${days} d ${remHours} h`;
}
