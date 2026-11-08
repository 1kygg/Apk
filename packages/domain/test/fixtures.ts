import { DateTime } from 'luxon';
import { type ActivityRecord, type ChallengeRules, type ChallengeRulesInput, validateRules } from '../src';

export function rules(overrides: Partial<ChallengeRulesInput> = {}): ChallengeRules {
  return validateRules({
    type: 'consistency',
    startsAt: '2026-11-02T00:00:00Z',
    endsAt: '2026-11-16T00:00:00Z',
    timezone: 'UTC',
    validDays: [1, 2, 3, 4, 5],
    dailyCap: 1,
    weeklyCap: 5,
    weekStartsOn: 1,
    allowedModalities: ['strength', 'walking', 'running', 'cycling', 'football', 'basketball', 'volleyball'],
    acceptedSources: ['self_reported', 'gps', 'manual', 'health_connect', 'healthkit'],
    syncGraceHours: 24,
    offlinePolicy: 'review',
    tieBreak: 'weeks_met',
    ...overrides,
  });
}
export function activity(id: string, start: string, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  const from = DateTime.fromISO(start, { setZone: true });
  const end = from.plus({ minutes: 30 });
  return {
    id, userId: 'alice', modality: 'strength', source: 'self_reported',
    eligibility: 'verified', verifiedStartAt: from.toUTC().toISO()!, verifiedEndAt: end.toUTC().toISO()!,
    receivedAt: end.plus({ minutes: 1 }).toUTC().toISO()!, activeSeconds: 1800, completed: true,
    ...overrides,
  };
}
export const AS_OF = { asOf: '2026-12-01T00:00:00Z' };
