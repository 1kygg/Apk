import { DateTime } from 'luxon';
import { MAX_CALENDAR_DAYS, type ChallengeRules, type MaximumResult, type ScoreUnit } from './types';

export interface CalendarDay {
  date: string;
  weekday: number;
  weekStart: string;
  kind: 'regular' | 'makeup' | 'unavailable';
  opportunity: boolean;
}
export function localDate(instantISO: string, timezone: string): string {
  const date = DateTime.fromISO(instantISO, { setZone: true }).setZone(timezone);
  if (!date.isValid) throw new RangeError('Data ou fuso inválido.');
  return date.toISODate()!;
}
export function weekdayForDate(dateISO: string, timezone: string): number {
  const date = DateTime.fromISO(dateISO, { zone: timezone });
  if (!date.isValid || date.toISODate() !== dateISO) throw new RangeError('Data local inválida.');
  return date.weekday;
}
export function weekStartForDate(dateISO: string, timezone: string, weekStartsOn: number): string {
  const date = DateTime.fromISO(dateISO, { zone: timezone });
  if (!date.isValid || !Number.isInteger(weekStartsOn) || weekStartsOn < 1 || weekStartsOn > 7) throw new RangeError('Semana inválida.');
  return date.minus({ days: (date.weekday - weekStartsOn + 7) % 7 }).toISODate()!;
}
export function scoreUnit(rules: ChallengeRules): ScoreUnit {
  return rules.type === 'consistency' ? 'points' : rules.type === 'steps' ? 'steps' : 'kilometers';
}
export function roundMetric(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Métrica fora do intervalo numérico representável.');
  return Number(value.toFixed(9));
}

/**
 * A wall-clock boundary in a local date. Ambiguous fall-back starts use the first
 * occurrence and ends use the last; a missing spring-forward boundary moves to
 * the first existing minute after the clock gap.
 */
function wallBoundary(day: DateTime, minute: number, end: boolean): number {
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  let boundary = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, hour, minute: minuteOfHour }, { zone: day.zoneName! });
  if (!boundary.isValid) return NaN;
  if (boundary.hour * 60 + boundary.minute !== minute) {
    for (let count = 0; count < 180; count += 1) {
      const previous: DateTime = boundary.minus({ minutes: 1 });
      if (previous.toISODate() !== day.toISODate() || previous.hour * 60 + previous.minute < minute) break;
      boundary = previous;
    }
  }
  const offsets = boundary.getPossibleOffsets().map(value => value.toMillis());
  return end ? Math.max(...offsets) : Math.min(...offsets);
}

function windowIntervals(day: DateTime, rules: ChallengeRules): Array<[number, number]> {
  if (rules.windowStartMinute === undefined || rules.windowEndMinute === undefined) {
    return [[DateTime.fromISO(rules.startsAt).toMillis(), DateTime.fromISO(rules.endsAt).toMillis()]];
  }
  const start = rules.windowStartMinute;
  const end = rules.windowEndMinute;
  if (end > start) return [[wallBoundary(day, start, false), wallBoundary(day, end, true)]];
  // An overnight window has both an early and a late episode on a calendar date.
  return [
    [wallBoundary(day.minus({ days: 1 }), start, false), wallBoundary(day, end, true)],
    [wallBoundary(day, start, false), wallBoundary(day.plus({ days: 1 }), end, true)],
  ];
}

/** Checks that the complete session fits one window, not just its endpoints. */
export function fitsTimeWindow(rules: ChallengeRules, startISO: string, endISO: string): boolean {
  if (rules.windowStartMinute === undefined) return true;
  const start = DateTime.fromISO(startISO, { setZone: true }).setZone(rules.timezone);
  const startMs = start.toMillis();
  const endMs = DateTime.fromISO(endISO, { setZone: true }).toMillis();
  return windowIntervals(start.startOf('day'), rules).some(([from, to]) => startMs >= from && startMs < to && endMs <= to && endMs > startMs);
}

function dateHasOpportunity(day: DateTime, rules: ChallengeRules): boolean {
  const challengeStart = DateTime.fromISO(rules.startsAt).toMillis();
  const challengeEnd = DateTime.fromISO(rules.endsAt).toMillis();
  const dateStart = day.startOf('day').toMillis();
  const nextDate = day.plus({ days: 1 }).startOf('day').toMillis();
  const minimumMs = rules.minimumActiveSeconds * 1000;
  return windowIntervals(day, rules).some(([from, to]) => {
    const earliestStart = Math.max(from, challengeStart, dateStart);
    const startExclusiveEnd = Math.min(to, challengeEnd, nextDate);
    const latestEnd = Math.min(to, challengeEnd);
    return earliestStart < startExclusiveEnd && earliestStart + minimumMs <= latestEnd;
  });
}

/** Dates use local calendar arithmetic; a DST day is never assumed to be 24 h. */
export function calendarDays(rules: ChallengeRules): CalendarDay[] {
  const first = DateTime.fromISO(rules.startsAt, { setZone: true }).setZone(rules.timezone).startOf('day');
  const lastMs = DateTime.fromISO(rules.endsAt, { setZone: true }).minus({ milliseconds: 1 }).setZone(rules.timezone).startOf('day').toMillis();
  const localEnd = DateTime.fromMillis(lastMs, { zone: rules.timezone });
  if (!first.isValid || !localEnd.isValid || localEnd.diff(first, 'days').days + 1 > MAX_CALENDAR_DAYS) {
    throw new RangeError('Período fora do limite técnico de processamento do calendário.');
  }
  const result: CalendarDay[] = [];
  for (let day = first; day.toMillis() <= lastMs; day = day.plus({ days: 1 }).startOf('day')) {
    const date = day.toISODate()!;
    const kind = rules.validDays.includes(day.weekday) ? 'regular' : rules.makeupDays.includes(day.weekday) ? 'makeup' : 'unavailable';
    result.push({
      date,
      weekday: day.weekday,
      weekStart: weekStartForDate(date, rules.timezone, rules.weekStartsOn),
      kind,
      opportunity: kind !== 'unavailable' && dateHasOpportunity(day, rules),
    });
  }
  return result;
}

/** Makeup dates replace missed dates and never increase this theoretical maximum. */
export function calculateMaximum(rules: ChallengeRules): MaximumResult {
  const byWeek = new Map<string, string[]>();
  for (const day of calendarDays(rules)) {
    const dates = byWeek.get(day.weekStart) ?? [];
    if (day.kind === 'regular' && day.opportunity) dates.push(day.date);
    byWeek.set(day.weekStart, dates);
  }
  const perDay = rules.type === 'consistency' ? Math.min(rules.pointsPerDay, rules.dailyCap) : rules.dailyCap;
  const weeks = [...byWeek].map(([weekStart, regularDates]) => ({
    weekStart,
    regularDates,
    maximum: roundMetric(Math.min(regularDates.length * perDay, rules.weeklyCap)),
  }));
  return { unit: scoreUnit(rules), weeks, total: roundMetric(weeks.reduce((total, week) => total + week.maximum, 0)) };
}
