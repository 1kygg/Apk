import {describe, expect, it} from 'vitest';
import {calculateLocalProgress, validateLocalScoringRules, type LocalScoreActivity} from './local-score';

const asOf = '2026-11-15T23:59:59Z';
function activity(id: string, date = '2026-11-09', patch: Partial<LocalScoreActivity> = {}): LocalScoreActivity {
  return {id, clientId: id, userId: 'local-person', modality: 'strength', source: 'self_reported',
    startedAt: date + 'T10:00:00Z', endedAt: date + 'T10:20:00Z', activeSeconds: 1200,
    status: 'completed', eligibility: 'local_only', ...patch};
}
describe('personal points from local history, without server or identity verification', () => {
  it('starts empty without invented participants or points', () => {
    const result = calculateLocalProgress([], 'UTC', {asOf});
    expect(result.totalPoints).toBe(0); expect(result.totalCompletedSessions).toBe(0);
    expect(result.currentWeek.points).toBe(0); expect(result.days).toEqual([]);
  });
  it('credits one point for a completed day regardless of sessions, modality or adaptation', () => {
    const result = calculateLocalProgress([activity('adapted', undefined, {activeSeconds: 0}),
      activity('run', undefined, {modality: 'running', source: 'gps', distanceMeters: 3000}), activity('more')], 'UTC', {asOf});
    expect(result.totalPoints).toBe(1); expect(result.totalCompletedSessions).toBe(3);
    expect(result.days[0].sessions).toBe(3); expect(result.distancesKm.running).toBe(3);
  });
  it('deduplicates repeated IDs and canonical client IDs', () => {
    const first = activity('one', undefined, {modality: 'walking', distanceMeters: 1000});
    const result = calculateLocalProgress([first, first, {...first, id: 'another-id'}], 'UTC', {asOf});
    expect(result.totalCompletedSessions).toBe(1); expect(result.distancesKm.walking).toBe(1);
    expect(result.excluded).toHaveLength(2);
  });
  it('does not let an incomplete or another-profile copy hide a completed local session', () => {
    const row = activity('same-id');
    const result = calculateLocalProgress([{...row, status: 'started'}, {...row, userId: 'another'}, row], 'UTC', {asOf, profileId: 'local-person'});
    expect(result.totalCompletedSessions).toBe(1); expect(result.totalPoints).toBe(1);
  });
  it('applies the weekly cap without turning rest days into extra points', () => {
    const rows = Array.from({length: 7}, (_, i) => activity(String(i), '2026-11-' + String(9 + i).padStart(2, '0')));
    const result = calculateLocalProgress(rows, 'UTC', {asOf});
    expect(result.totalPoints).toBe(5); expect(result.currentWeek.points).toBe(5);
    expect(result.totalCompletedSessions).toBe(7); expect(result.days.filter(day => day.points === 0)).toHaveLength(2);
  });
  it('resets at the configured start of week and handles incomplete weeks', () => {
    const result = calculateLocalProgress([activity('mon', '2026-11-09'), activity('tue', '2026-11-10'),
      activity('wed', '2026-11-11')], 'UTC', {asOf, weekStartsOn: 3, weeklyCap: 2});
    expect(result.weeks).toEqual([{start: '2026-11-11', points: 1, goalMet: false}, {start: '2026-11-04', points: 2, goalMet: true}]);
    expect(result.currentWeek.points).toBe(1); expect(result.totalPoints).toBe(3);
  });
  it('uses the stored routine timezone and attributes midnight crossings to the start day', () => {
    const rows = [activity('late', undefined, {startedAt: '2026-11-10T02:50:00Z', endedAt: '2026-11-10T03:10:00Z'}),
      activity('same-day', '2026-11-09')];
    expect(calculateLocalProgress(rows, 'America/Sao_Paulo', {asOf}).totalPoints).toBe(1);
    expect(calculateLocalProgress(rows, 'UTC', {asOf}).totalPoints).toBe(2);
  });
  it('handles DST through calendar dates instead of fixed 24-hour windows', () => {
    const result = calculateLocalProgress([activity('before', undefined, {startedAt: '2026-11-01T05:10:00Z', endedAt: '2026-11-01T05:30:00Z'}),
      activity('after', undefined, {startedAt: '2026-11-01T06:10:00Z', endedAt: '2026-11-01T06:30:00Z'})], 'America/New_York', {asOf});
    expect(result.totalPoints).toBe(1); expect(result.days[0].date).toBe('2026-11-01');
  });
  it('keeps kilometers separate and never converts distance or steps into constancy points', () => {
    const result = calculateLocalProgress([activity('walk', undefined, {modality: 'walking', distanceMeters: 1000}),
      activity('run', undefined, {modality: 'running', distanceMeters: 2500}),
      activity('cycle', undefined, {modality: 'cycling', distanceMeters: 9000})], 'UTC', {asOf});
    expect(result.distancesKm).toEqual({walking: 1, running: 2.5, cycling: 9}); expect(result.totalPoints).toBe(1);
  });
  it('preserves constancy for a self-declared completed session but omits flagged GPS kilometers', () => {
    const result = calculateLocalProgress([activity('mock', undefined, {modality: 'running', source: 'gps', distanceMeters: 9000, anomalies: ['mock_location']})], 'UTC', {asOf});
    expect(result.totalPoints).toBe(1); expect(result.distancesKm.running).toBe(0); expect(result.flaggedDistanceSessions).toBe(1);
  });
  it('ignores incomplete, deleted, invalid, future or other-profile rows', () => {
    const rows = [activity('started', undefined, {status: 'started'}), activity('deleted', undefined, {deleted: true}),
      activity('invalid', undefined, {startedAt: 'bad'}), activity('future', '2026-12-01'), activity('other', undefined, {userId: 'another'})];
    expect(calculateLocalProgress(rows, 'UTC', {asOf, profileId: 'local-person'}).totalPoints).toBe(0);
  });
  it('recomputes after deletion and after explicit changes to valid days', () => {
    const monday = activity('monday', '2026-11-09'), tuesday = activity('tuesday', '2026-11-10');
    expect(calculateLocalProgress([monday, tuesday], 'UTC', {asOf}).totalPoints).toBe(2);
    expect(calculateLocalProgress([tuesday], 'UTC', {asOf}).totalPoints).toBe(1);
    expect(calculateLocalProgress([monday, tuesday], 'UTC', {asOf, validDays: [1]}).totalPoints).toBe(1);
  });
  it('validates configuration and dates instead of silently inventing a timezone', () => {
    expect(() => validateLocalScoringRules({validDays: []})).toThrow();
    expect(() => validateLocalScoringRules({weeklyCap: 0})).toThrow();
    expect(() => validateLocalScoringRules({weekStartsOn: 0})).toThrow();
    expect(() => calculateLocalProgress([], 'invalid', {asOf})).toThrow();
    expect(() => calculateLocalProgress([], 'UTC', {asOf: 'invalid'})).toThrow();
  });
});
