const dateHourFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateHourFormatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  dateHourFormatterCache.set(timeZone, created);
  return created;
}

function partsMap(date: Date, timeZone: string): Record<string, string> {
  const parts = formatter(timeZone).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = partsMap(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function zonedLocalToUtcCandidates(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date[] {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const instants = new Set<number>();
  for (const sampleOffset of [
    0, 3_600_000, -3_600_000, 7_200_000, -7_200_000,
  ]) {
    const offset = tzOffsetMs(timeZone, new Date(utcGuess + sampleOffset));
    const instant = utcGuess - offset;
    const parts = partsMap(new Date(instant), timeZone);
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute &&
      Number(parts.second) === second
    ) {
      instants.add(instant);
    }
  }
  return [...instants]
    .sort((left, right) => left - right)
    .map((value) => new Date(value));
}

export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  const candidates = zonedLocalToUtcCandidates(
    timeZone,
    year,
    month,
    day,
    hour,
    minute,
    second,
  );
  if (candidates[0]) return candidates[0];
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = tzOffsetMs(timeZone, new Date(utcGuess));
  let instant = utcGuess - firstOffset;
  const secondOffset = tzOffsetMs(timeZone, new Date(instant));
  if (secondOffset !== firstOffset) {
    instant = utcGuess - secondOffset;
  }
  return new Date(instant);
}

export function zonedDateHour(
  date: Date,
  timeZone: string,
): { date: string; hour: number } {
  const parts = partsMap(date, timeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export function parseIsoDateParts(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid reporting date: ${value}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function firstLocalHourCandidates(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
): Date[] {
  for (let candidateHour = hour; candidateHour < 24; candidateHour += 1) {
    const matches = zonedLocalToUtcCandidates(
      timeZone,
      year,
      month,
      day,
      candidateHour,
    );
    if (matches.length > 0) return matches;
  }
  return zonedLocalToUtcCandidates(
    timeZone,
    ...addCalendarDay(year, month, day),
    0,
  );
}

export function zonedHourUtcRange(
  timeZone: string,
  date: string,
  hour: number,
): { start: Date; end: Date } {
  const { year, month, day } = parseIsoDateParts(date);
  const starts = zonedLocalToUtcCandidates(timeZone, year, month, day, hour);
  if (starts.length === 0) {
    const skipped = firstLocalHourCandidates(
      timeZone,
      year,
      month,
      day,
      hour + 1,
    )[0];
    const instant =
      skipped ?? zonedLocalToUtc(timeZone, year, month, day, hour);
    return { start: instant, end: instant };
  }
  const start = starts[0]!;
  const nextHour = hour + 1;
  const endCandidates =
    nextHour >= 24
      ? zonedLocalToUtcCandidates(
          timeZone,
          ...addCalendarDay(year, month, day),
          0,
        )
      : firstLocalHourCandidates(timeZone, year, month, day, nextHour);
  const end =
    endCandidates.find((instant) => instant.getTime() > start.getTime()) ??
    new Date(start.getTime());
  return { start, end };
}

function addCalendarDay(
  year: number,
  month: number,
  day: number,
): [number, number, number] {
  const utc = new Date(Date.UTC(year, month - 1, day + 1));
  return [utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()];
}

export function enumerateZonedDates(
  start: Date,
  end: Date,
  timeZone: string,
): string[] {
  const first = zonedDateHour(start, timeZone).date;
  const last = zonedDateHour(
    new Date(Math.max(start.getTime(), end.getTime() - 1)),
    timeZone,
  ).date;
  const dates: string[] = [];
  let { year, month, day } = parseIsoDateParts(first);
  const lastParts = parseIsoDateParts(last);
  while (
    year < lastParts.year ||
    (year === lastParts.year && month < lastParts.month) ||
    (year === lastParts.year &&
      month === lastParts.month &&
      day <= lastParts.day)
  ) {
    dates.push(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
    [year, month, day] = addCalendarDay(year, month, day);
    if (dates.length > 400) break;
  }
  return dates;
}

export function overlapMs(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): number {
  const start = Math.max(leftStart.getTime(), rightStart.getTime());
  const end = Math.min(leftEnd.getTime(), rightEnd.getTime());
  return Math.max(0, end - start);
}
