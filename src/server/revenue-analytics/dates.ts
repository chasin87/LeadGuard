import {
  parseIsoDateParts,
  zonedDateHour,
  zonedLocalToUtc,
} from "@/server/google-ads/impact/timezone";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function utcDateFromIso(value: string): Date {
  const { year, month, day } = parseIsoDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoFromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addIsoDays(value: string, days: number): string {
  const { year, month, day } = parseIsoDateParts(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoFromUtcDate(shifted);
}

export function compareIsoDate(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isoDateInRange(
  value: string,
  from: string,
  through: string,
): boolean {
  return value >= from && value <= through;
}

export function todayInTimeZone(now: Date, timeZone: string): string {
  return zonedDateHour(now, timeZone).date;
}

export function daysBetweenIso(from: string, through: string): number {
  const start = utcDateFromIso(from).getTime();
  const end = utcDateFromIso(through).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function subtractCalendarMonths(
  isoDate: string,
  months: number,
): string {
  const { year, month, day } = parseIsoDateParts(isoDate);
  const shifted = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return isoFromUtcDate(
    new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), clampedDay),
    ),
  );
}

export function enumerateIsoDates(from: string, through: string): string[] {
  if (from > through) return [];
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= through) {
    dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
    if (dates.length > 1200) break;
  }
  return dates;
}

export function cohortDateForLead(input: {
  acquisitionCapturedAt: Date;
  googleClickDate: string | null;
  timeZone: string;
}): string {
  if (input.googleClickDate && isIsoDate(input.googleClickDate)) {
    return input.googleClickDate;
  }
  return zonedDateHour(input.acquisitionCapturedAt, input.timeZone).date;
}

export function startOfZonedDate(isoDate: string, timeZone: string): Date {
  const { year, month, day } = parseIsoDateParts(isoDate);
  return zonedLocalToUtc(timeZone, year, month, day, 0, 0, 0);
}
