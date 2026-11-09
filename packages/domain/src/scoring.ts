import { DateTime } from 'luxon';
import { ActivityRecordSchema, type ActivityRecord, type ChallengeRules, type RankingEntry, type RankingParticipant, type ScoreCredit, type ScoreExclusion, type ScoringResult, type UserScore } from './types';
import { calendarDays, fitsTimeWindow, localDate, roundMetric, scoreUnit, weekStartForDate } from './calendar';

export interface ScoringOptions { /** Backend server time only, never a client-supplied value. */ asOf?: string }
interface Candidate { activity: ActivityRecord; startMs: number; date: string; weekStart: string }
interface UserState {
  score: UserScore;
  daily: Map<string, number>;
  weekly: Map<string, number>;
  usedRegularDates: Set<string>;
  makeupTargets: Map<string, string>;
}

/**
 * Pure deterministic recomputation. Trust boundary: verified timestamps and
 * eligibility must be assigned by the server, not copied from a client request.
 * An unverifiable offline record stays in history but earns no score here.
 */
export function scoreActivities(rules: ChallengeRules, records: readonly ActivityRecord[], options: ScoringOptions = {}): ScoringResult {
  const now = options.asOf ? DateTime.fromISO(options.asOf, { setZone: true }) : DateTime.utc();
  if (!now.isValid) throw new RangeError('Hora do servidor inválida.');
  const asOfMs = now.toMillis();
  const challengeStart = DateTime.fromISO(rules.startsAt).toMillis();
  const challengeEnd = DateTime.fromISO(rules.endsAt).toMillis();
  const deadline = DateTime.fromMillis(challengeEnd).plus({ hours: rules.syncGraceHours }).toMillis();
  const calendar = calendarDays(rules);
  const dates = new Map(calendar.map(day => [day.date, day]));
  const weekDates = new Map<string, string[]>();
  const weekIds = [...new Set(calendar.map(day => day.weekStart))];
  for (const day of calendar) {
    if (day.kind !== 'regular' || !day.opportunity) continue;
    weekDates.set(day.weekStart, [...(weekDates.get(day.weekStart) ?? []), day.date]);
  }
  const excluded: ScoreExclusion[] = [];
  const states = new Map<string, UserState>();
  const stateFor = (userId: string) => {
    let state = states.get(userId);
    if (!state) {
      state = { score: { userId, total: 0, weeksMet: 0, weeks: [], credits: [] }, daily: new Map(), weekly: new Map(), usedRegularDates: new Set(), makeupTargets: new Map() };
      states.set(userId, state);
    }
    return state;
  };
  const exclude = (activity: Pick<ActivityRecord, 'id' | 'userId'>, reason: string) => excluded.push({ activityId: activity.id, userId: activity.userId, reason });

  const parsed: ActivityRecord[] = [];
  for (const raw of records) {
    const result = ActivityRecordSchema.safeParse(raw);
    if (!result.success) {
      exclude({ id: typeof raw?.id === 'string' ? raw.id : 'invalid', userId: typeof raw?.userId === 'string' ? raw.userId : 'invalid' }, 'invalid_record');
      continue;
    }
    parsed.push(result.data);
    stateFor(result.data.userId);
  }
  // Conflicting payloads for one immutable ID cannot make an arbitrary winner.
  const grouped = new Map<string, ActivityRecord[]>();
  for (const activity of parsed) grouped.set(activity.id, [...(grouped.get(activity.id) ?? []), activity]);
  const unique: ActivityRecord[] = [];
  for (const group of grouped.values()) {
    if (new Set(group.map(activity => JSON.stringify(activity))).size > 1) {
      for (const activity of group) exclude(activity, 'conflicting_duplicate');
      continue;
    }
    unique.push(group[0]!);
    for (const duplicate of group.slice(1)) exclude(duplicate, 'duplicate');
  }

  const candidates: Candidate[] = [];
  for (const activity of unique) {
    let reason: string | undefined;
    const start = activity.verifiedStartAt ? DateTime.fromISO(activity.verifiedStartAt).toMillis() : NaN;
    const end = activity.verifiedEndAt ? DateTime.fromISO(activity.verifiedEndAt).toMillis() : NaN;
    const received = DateTime.fromISO(activity.receivedAt).toMillis();
    if (activity.deleted) reason = 'deleted';
    else if (!activity.completed) reason = 'not_completed';
    else if (activity.eligibility !== 'verified') reason = activity.eligibility === 'pending_review' ? 'pending_review' : 'ineligible';
    else if (!Number.isFinite(start) || !Number.isFinite(end)) reason = 'unverified_time';
    else if (end <= start || activity.activeSeconds > (end - start) / 1000 + 1) reason = 'invalid_duration';
    else if (end > asOfMs || received > asOfMs || received < end) reason = 'invalid_server_time';
    else if (start < challengeStart || start >= challengeEnd || end > challengeEnd) reason = 'outside_challenge';
    else if (received > deadline) reason = 'sync_deadline';
    else if (!rules.acceptedSources.includes(activity.source)) reason = 'source_not_accepted';
    else if (!rules.allowedModalities.includes(activity.modality)) reason = 'modality_not_accepted';
    else if (activity.activeSeconds < rules.minimumActiveSeconds) reason = 'minimum_active_time';
    else if (!fitsTimeWindow(rules, activity.verifiedStartAt!, activity.verifiedEndAt!)) reason = 'outside_time_window';
    else if (rules.type !== 'consistency' && rules.type !== 'steps' && activity.modality !== rules.type) reason = 'wrong_distance_modality';
    else if (rules.type === 'steps' && activity.modality !== 'walking' && activity.modality !== 'running') reason = 'steps_not_applicable';
    if (reason) { exclude(activity, reason); continue; }
    const date = localDate(activity.verifiedStartAt!, rules.timezone);
    const calendarDay = dates.get(date);
    if (!calendarDay?.opportunity) { exclude(activity, 'invalid_day'); continue; }
    candidates.push({ activity, startMs: start, date, weekStart: weekStartForDate(date, rules.timezone, rules.weekStartsOn) });
  }
  candidates.sort((a, b) => a.startMs - b.startMs || a.activity.id.localeCompare(b.activity.id));
  for (const { activity, date, weekStart } of candidates) {
    const state = stateFor(activity.userId);
    const day = dates.get(date)!;
    const usedToday = state.daily.get(date) ?? 0;
    if (rules.type === 'consistency' && usedToday > 0) { exclude(activity, 'daily_award_already_used'); continue; }
    let recoveredDate: string | undefined;
    if (day.kind === 'makeup') {
      recoveredDate = state.makeupTargets.get(date) ?? weekDates.get(weekStart)?.find(regular => regular < date && !state.usedRegularDates.has(regular));
      if (!recoveredDate) { exclude(activity, 'no_previous_missed_day'); continue; }
    }
    const rawValue = rules.type === 'consistency' ? rules.pointsPerDay : rules.type === 'steps' ? activity.steps ?? 0 : (activity.distanceMeters ?? 0) / 1000;
    if (rawValue <= 0) { exclude(activity, 'missing_metric'); continue; }
    const remainingDaily = rules.dailyCap - usedToday;
    const remainingWeekly = rules.weeklyCap - (state.weekly.get(weekStart) ?? 0);
    // A makeup can only use the capacity of one regular opportunity.
    const regularPerDay = rules.type === 'consistency' ? Math.min(rules.pointsPerDay, rules.dailyCap) : rules.dailyCap;
    const opportunityCap = recoveredDate ? regularPerDay - usedToday : remainingDaily;
    const value = roundMetric(Math.min(rawValue, remainingDaily, remainingWeekly, opportunityCap));
    if (value <= 0) { exclude(activity, remainingWeekly <= 0 ? 'weekly_cap' : 'daily_cap'); continue; }
    const credit: ScoreCredit = { activityId: activity.id, userId: activity.userId, date, weekStart, value, kind: recoveredDate ? 'makeup' : 'regular', ...(recoveredDate ? { recoveredDate } : {}) };
    state.score.credits.push(credit);
    state.daily.set(date, roundMetric(usedToday + value));
    state.weekly.set(weekStart, roundMetric((state.weekly.get(weekStart) ?? 0) + value));
    state.usedRegularDates.add(recoveredDate ?? date);
    if (recoveredDate) state.makeupTargets.set(date, recoveredDate);
  }
  const users = [...states.values()].map(state => {
    state.score.weeks = weekIds.map(weekStart => {
      const total = state.weekly.get(weekStart) ?? 0;
      return { weekStart, total, goal: rules.weeklyGoal, met: total + 1e-9 >= rules.weeklyGoal };
    });
    state.score.total = roundMetric(state.score.weeks.reduce((sum, week) => sum + week.total, 0));
    state.score.weeksMet = state.score.weeks.filter(week => week.met).length;
    return state.score;
  }).sort((a, b) => a.userId.localeCompare(b.userId));
  return { unit: scoreUnit(rules), asOf: now.toUTC().toISO()!, users, excluded };
}

/** Rank with gaps (1, 1, 3). Names are presentation order only, never a tie-break. */
export function classifyRanking(rules: ChallengeRules, result: ScoringResult, participants: readonly RankingParticipant[] = []): RankingEntry[] {
  const identities = new Map(participants.map(participant => [participant.userId, participant]));
  const scores = new Map(result.users.map(user => [user.userId, user]));
  const ids = new Set([...identities.keys(), ...scores.keys()]);
  const entries = [...ids].map(userId => ({
    userId,
    displayName: identities.get(userId)?.displayName ?? 'Participante',
    ...(identities.get(userId)?.avatarUrl ? { avatarUrl: identities.get(userId)!.avatarUrl } : {}),
    total: scores.get(userId)?.total ?? 0,
    weeksMet: scores.get(userId)?.weeksMet ?? 0,
    position: 0,
  })).sort((a, b) => b.total - a.total || (rules.tieBreak === 'weeks_met' ? b.weeksMet - a.weeksMet : 0) || a.displayName.localeCompare(b.displayName, 'pt-BR') || a.userId.localeCompare(b.userId));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const previous = entries[index - 1];
    const tied = previous && Math.abs(entry.total - previous.total) < 1e-9 && (rules.tieBreak === 'shared' || entry.weeksMet === previous.weeksMet);
    entry.position = tied ? previous.position : index + 1;
  }
  return entries;
}
