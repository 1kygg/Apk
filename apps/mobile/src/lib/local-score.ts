import {DateTime, IANAZone} from 'luxon';

export interface LocalScoreActivity {
  id: string;
  clientId?: string;
  userId?: string;
  modality: string;
  source: string;
  startedAt: string;
  endedAt?: string | null;
  activeSeconds: number;
  distanceMeters?: number | null;
  status?: string;
  eligibility?: string;
  deleted?: boolean;
  anomalies?: string[];
  warnings?: string[];
}

export interface LocalScoringRules {
  dailyCap: number;
  weeklyCap: number;
  weekStartsOn: number;
  validDays: number[];
}

export const DEFAULT_LOCAL_SCORING_RULES: LocalScoringRules = {
  dailyCap: 1,
  weeklyCap: 5,
  weekStartsOn: 1,
  validDays: [1, 2, 3, 4, 5, 6, 7],
};

export interface LocalScoreDay {
  date: string;
  weekStart: string;
  points: number;
  sessions: number;
  validDay: boolean;
}

export interface LocalProgress {
  asOf: string;
  timezone: string;
  rules: LocalScoringRules;
  totalPoints: number;
  totalCompletedSessions: number;
  creditedDays: number;
  currentWeek: {start: string; end: string; points: number; creditedDays: number; limit: number};
  days: LocalScoreDay[];
  weeks: {start: string; points: number; goalMet: boolean}[];
  distancesKm: {walking: number; running: number; cycling: number};
  flaggedDistanceSessions: number;
  excluded: {id: string; reason: string}[];
}

export function validateLocalScoringRules(input: Partial<LocalScoringRules> = {}): LocalScoringRules {
  const rules = {...DEFAULT_LOCAL_SCORING_RULES, ...input};
  if (!Number.isInteger(rules.dailyCap) || rules.dailyCap < 1 || rules.dailyCap > 1000 ||
      !Number.isInteger(rules.weeklyCap) || rules.weeklyCap < rules.dailyCap || rules.weeklyCap > 7000) {
    throw new Error('Informe limites inteiros válidos. O limite semanal deve ser igual ou maior que o diário.');
  }
  if (!Number.isInteger(rules.weekStartsOn) || rules.weekStartsOn < 1 || rules.weekStartsOn > 7) {
    throw new Error('Escolha o primeiro dia da semana.');
  }
  if (!Array.isArray(rules.validDays) || rules.validDays.length < 1 || rules.validDays.length > 7 ||
      rules.validDays.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
      new Set(rules.validDays).size !== rules.validDays.length) {
    throw new Error('Escolha pelo menos um dia válido, sem repetir dias.');
  }
  return {...rules, validDays: [...rules.validDays].sort((a, b) => a - b)};
}

function weekStart(day: DateTime, startsOn: number): DateTime {
  return day.startOf('day').minus({days: (day.weekday - startsOn + 7) % 7});
}

/**
 * Personal device-only accounting. It does not establish identity or prove
 * exercise execution/time, and never turns device data into server verification.
 */
export function calculateLocalProgress(
  activities: LocalScoreActivity[],
  timezone: string,
  options: Partial<LocalScoringRules> & {asOf?: string; profileId?: string} = {},
): LocalProgress {
  if (!IANAZone.isValidZone(timezone)) throw new Error('Informe um fuso horário válido para sua rotina.');
  const {asOf, profileId, ...ruleOptions} = options;
  const rules = validateLocalScoringRules(ruleOptions);
  const now = asOf ? DateTime.fromISO(asOf, {setZone: true}) : DateTime.now();
  if (!now.isValid) throw new Error('Horário local de referência inválido.');
  const currentStart = weekStart(now.setZone(timezone), rules.weekStartsOn);
  const excluded: LocalProgress['excluded'] = [];
  const byDay = new Map<string, {date: DateTime; sessions: number}>();
  const seenIds = new Set<string>(), seenClients = new Set<string>();
  const meters = {walking: 0, running: 0, cycling: 0};
  let completed = 0, flaggedDistanceSessions = 0;
  const modalities = new Set(['strength', 'walking', 'running', 'cycling', 'football', 'basketball', 'volleyball']);

  for (const activity of activities) {
    if (profileId && activity.userId && activity.userId !== profileId) {
      excluded.push({id: activity.id, reason: 'another_profile'}); continue;
    }
    if (activity.deleted || activity.status !== 'completed' || !modalities.has(activity.modality) ||
        activity.eligibility === 'ineligible' || activity.eligibility === 'pending_review') {
      excluded.push({id: activity.id, reason: 'not_completed_or_eligible'}); continue;
    }
    const start = DateTime.fromISO(activity.startedAt, {setZone: true}).setZone(timezone);
    const end = activity.endedAt ? DateTime.fromISO(activity.endedAt, {setZone: true}) : null;
    if (!start.isValid || !end?.isValid || end.toMillis() < start.toMillis() || end.toMillis() > now.toMillis() ||
        !Number.isFinite(activity.activeSeconds) || activity.activeSeconds < 0 ||
        activity.activeSeconds > (end.toMillis() - start.toMillis()) / 1000 + 1) {
      excluded.push({id: activity.id, reason: 'invalid_or_future_interval'}); continue;
    }
    if (!activity.id || seenIds.has(activity.id) || (activity.clientId && seenClients.has(activity.clientId))) {
      excluded.push({id: activity.id, reason: 'duplicate'}); continue;
    }
    seenIds.add(activity.id);
    if (activity.clientId) seenClients.add(activity.clientId);
    const date = start.toISODate()!;
    const existing = byDay.get(date);
    byDay.set(date, {date: start.startOf('day'), sessions: (existing?.sessions ?? 0) + 1});
    completed++;
    if (activity.modality === 'walking' || activity.modality === 'running' || activity.modality === 'cycling') {
      const flagged = activity.source === 'gps' && (
        (activity.anomalies?.length ?? 0) > 0 ||
        activity.warnings?.some(warning => /implausible|mock|jump/.test(warning))
      );
      if (flagged) flaggedDistanceSessions++;
      else if (activity.distanceMeters != null && Number.isFinite(activity.distanceMeters) && activity.distanceMeters >= 0) {
        meters[activity.modality] += activity.distanceMeters;
      }
    }
  }

  const weekPoints = new Map<string, number>();
  const days: LocalScoreDay[] = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => {
    const start = weekStart(value.date, rules.weekStartsOn).toISODate()!;
    const used = weekPoints.get(start) ?? 0;
    const validDay = rules.validDays.includes(value.date.weekday);
    // One completed day earns one point; session count/intensity never adds points.
    const points = validDay ? Math.min(1, rules.dailyCap, Math.max(0, rules.weeklyCap - used)) : 0;
    weekPoints.set(start, used + points);
    return {date, weekStart: start, points, sessions: value.sessions, validDay};
  });
  const currentDate = currentStart.toISODate()!;
  return {
    asOf: now.toUTC().toISO()!, timezone, rules,
    totalPoints: days.reduce((sum, day) => sum + day.points, 0),
    totalCompletedSessions: completed,
    creditedDays: days.filter(day => day.points > 0).length,
    currentWeek: {
      start: currentDate, end: currentStart.plus({days: 6}).toISODate()!,
      points: weekPoints.get(currentDate) ?? 0,
      creditedDays: days.filter(day => day.weekStart === currentDate && day.points > 0).length,
      limit: rules.weeklyCap,
    },
    days: [...days].reverse(),
    weeks: [...weekPoints].map(([start, points]) => ({start, points, goalMet: points >= rules.weeklyCap})).reverse(),
    distancesKm: {
      walking: Math.round(meters.walking) / 1000,
      running: Math.round(meters.running) / 1000,
      cycling: Math.round(meters.cycling) / 1000,
    },
    flaggedDistanceSessions, excluded,
  };
}
