import { describe, expect, it } from 'vitest';
import { classifyRanking, scoreActivities, type ActivityRecord } from '../src';
import { activity, AS_OF, rules } from './fixtures';

describe('pontuação determinística no servidor', () => {
  it('não concede pontos extras por reenvio ou sessões no mesmo dia', () => {
    const first = activity('a', '2026-11-02T12:00:00Z');
    const result = scoreActivities(rules(), [first, first, activity('b', '2026-11-02T16:00:00Z')], AS_OF);
    expect(result.users[0]!.total).toBe(1);
    expect(result.users[0]!.credits).toHaveLength(1);
    expect(result.excluded.map(entry => entry.reason)).toContain('duplicate');
    expect(result.excluded.map(entry => entry.reason)).toContain('daily_award_already_used');
  });
  it('um ID com payload conflitante não escolhe um vencedor arbitrário', () => {
    const first = activity('same', '2026-11-02T12:00:00Z');
    const result = scoreActivities(rules(), [first, { ...first, userId: 'bob' }], AS_OF);
    expect(result.users.every(user => user.total === 0)).toBe(true);
    expect(result.excluded.every(entry => entry.reason === 'conflicting_duplicate')).toBe(true);
  });
  it('limita a semana sem distinguir dificuldade nem modalidade adaptada', () => {
    const config = rules({ weeklyCap: 2 });
    const result = scoreActivities(config, [
      activity('mon', '2026-11-02T12:00:00Z'),
      activity('tue', '2026-11-03T12:00:00Z', { modality: 'walking', source: 'gps', distanceMeters: 10 }),
      activity('wed', '2026-11-04T12:00:00Z'),
    ], AS_OF);
    expect(result.users[0]!.total).toBe(2);
    expect(result.users[0]!.weeksMet).toBe(1);
    expect(result.excluded.at(-1)?.reason).toBe('weekly_cap');
  });
  it('usa o dia de início local e aceita cruzar meia-noite sem janela', () => {
    const result = scoreActivities(rules({ timezone: 'America/Sao_Paulo' }), [
      activity('night', '2026-11-03T02:50:00Z'),
    ], AS_OF);
    expect(result.users[0]!.credits[0]?.date).toBe('2026-11-02');
  });
  it('receber o registro em outro dia não altera o dia pontuado', () => {
    const result = scoreActivities(rules(), [
      activity('late', '2026-11-02T12:00:00Z', { receivedAt: '2026-11-04T12:00:00Z' }),
    ], AS_OF);
    expect(result.users[0]!.credits[0]?.date).toBe('2026-11-02');
  });
  it('aceita a conclusão exatamente no encerramento, sem aceitar inícios no encerramento', () => {
    const config = rules({ endsAt: '2026-11-03T00:00:00Z', validDays: [1, 2] });
    const result = scoreActivities(config, [
      activity('fits', '2026-11-02T23:30:00Z'),
      activity('after', '2026-11-03T00:00:00Z'),
      activity('crosses', '2026-11-02T23:45:00Z'),
    ], AS_OF);
    expect(result.users[0]!.credits.map(credit => credit.activityId)).toEqual(['fits']);
    expect(result.excluded.filter(entry => entry.reason === 'outside_challenge')).toHaveLength(2);
  });
  it('impede início anterior ao desafio ainda que a conclusão esteja dentro', () => {
    const result = scoreActivities(rules(), [activity('before', '2026-11-01T23:45:00Z')], AS_OF);
    expect(result.users[0]!.total).toBe(0);
    expect(result.excluded[0]?.reason).toBe('outside_challenge');
  });
  it('exige janela contínua e permite janela noturna explicitamente configurada', () => {
    const config = rules({ windowStartMinute: 22 * 60, windowEndMinute: 2 * 60 });
    const result = scoreActivities(config, [
      activity('night', '2026-11-02T23:45:00Z'),
      activity('outside', '2026-11-03T01:50:00Z'),
      activity('daytime', '2026-11-04T12:00:00Z'),
    ], AS_OF);
    expect(result.users[0]!.credits.map(credit => credit.activityId)).toEqual(['night']);
    expect(result.excluded.every(entry => entry.reason === 'outside_time_window')).toBe(true);
  });
  it('não aceita uma sessão longa só porque ambos os extremos estão em janelas diferentes', () => {
    const result = scoreActivities(rules({ windowStartMinute: 22 * 60, windowEndMinute: 2 * 60 }), [
      activity('long', '2026-11-02T23:00:00Z', { verifiedEndAt: '2026-11-03T23:30:00Z', receivedAt: '2026-11-03T23:31:00Z' }),
    ], AS_OF);
    expect(result.excluded[0]?.reason).toBe('outside_time_window');
  });
  it('reposição recupera só uma oportunidade regular anterior na mesma semana', () => {
    const config = rules({ endsAt: '2026-11-09T00:00:00Z', validDays: [1, 3], makeupDays: [5, 6], weeklyCap: 3 });
    const result = scoreActivities(config, [
      activity('regular', '2026-11-04T12:00:00Z'),
      activity('makeup', '2026-11-06T12:00:00Z'),
      activity('extra', '2026-11-07T12:00:00Z'),
    ], AS_OF);
    expect(result.users[0]!.total).toBe(2);
    expect(result.users[0]!.credits[1]).toMatchObject({ kind: 'makeup', recoveredDate: '2026-11-02' });
    expect(result.excluded.at(-1)?.reason).toBe('no_previous_missed_day');
  });
  it('reposição não antecipa um dia futuro nem recupera a semana anterior', () => {
    const config = rules({ validDays: [3, 5], makeupDays: [1] });
    const result = scoreActivities(config, [
      activity('firstMonday', '2026-11-02T12:00:00Z'),
      activity('nextMonday', '2026-11-09T12:00:00Z'),
    ], AS_OF);
    expect(result.users[0]!.total).toBe(0);
    expect(result.excluded.every(entry => entry.reason === 'no_previous_missed_day')).toBe(true);
  });
  it('não mistura modalidades nem converte distância em pontos de constância', () => {
    const records = [
      activity('run', '2026-11-02T12:00:00Z', { modality: 'running', source: 'gps', distanceMeters: 2500 }),
      activity('ride', '2026-11-03T12:00:00Z', { modality: 'cycling', source: 'gps', distanceMeters: 40_000 }),
    ];
    const distance = scoreActivities(rules({ type: 'running', dailyCap: 10, weeklyCap: 40 }), records, AS_OF);
    expect(distance.users[0]!.total).toBe(2.5);
    expect(distance.unit).toBe('kilometers');
    expect(distance.excluded[0]?.reason).toBe('wrong_distance_modality');
    expect(scoreActivities(rules(), records, AS_OF).users[0]!.total).toBe(2);
  });
  it('soma distâncias compatíveis até limites diário e semanal', () => {
    const result = scoreActivities(rules({ type: 'walking', dailyCap: 3, weeklyCap: 5 }), [
      activity('a', '2026-11-02T12:00:00Z', { modality: 'walking', distanceMeters: 2500 }),
      activity('b', '2026-11-02T15:00:00Z', { modality: 'walking', distanceMeters: 2500 }),
      activity('c', '2026-11-03T12:00:00Z', { modality: 'walking', distanceMeters: 3000 }),
    ], AS_OF);
    expect(result.users[0]!.credits.map(credit => credit.value)).toEqual([2.5, 0.5, 2]);
    expect(result.users[0]!.total).toBe(5);
  });
  it('não atribui passos a ciclismo e exige a fonte aceita', () => {
    const config = rules({ type: 'steps', dailyCap: 10000, weeklyCap: 50000, acceptedSources: ['health_connect'] });
    const result = scoreActivities(config, [
      activity('walk', '2026-11-02T12:00:00Z', { modality: 'walking', source: 'health_connect', steps: 1200 }),
      activity('ride', '2026-11-03T12:00:00Z', { modality: 'cycling', source: 'health_connect', steps: 5000 }),
      activity('manual', '2026-11-04T12:00:00Z', { modality: 'walking', source: 'manual', steps: 9000 }),
    ], AS_OF);
    expect(result.users[0]!.total).toBe(1200);
    expect(result.excluded.map(entry => entry.reason)).toEqual(['steps_not_applicable', 'source_not_accepted']);
  });
  it.each<[string, Partial<ActivityRecord>]>([
    ['pending_review', { eligibility: 'pending_review' as const }],
    ['ineligible', { eligibility: 'ineligible' as const }],
    ['unverified_time', { verifiedStartAt: null }],
    ['not_completed', { completed: false }],
    ['deleted', { deleted: true }],
    ['invalid_duration', { activeSeconds: 99999 }],
    ['sync_deadline', { receivedAt: '2026-11-18T00:00:00Z' }],
    ['source_not_accepted', { source: 'manual' as const }],
    ['minimum_active_time', { activeSeconds: 20 }],
  ])('preserva registro inelegível sem pontuar: %s', (reason, override) => {
    const result = scoreActivities(rules({ acceptedSources: ['self_reported'], minimumActiveSeconds: 60 }), [activity('a', '2026-11-02T12:00:00Z', override)], AS_OF);
    expect(result.users[0]!.total).toBe(0);
    expect(result.excluded[0]?.reason).toBe(reason);
  });
  it('recusa conclusão futura e recebimento anterior à conclusão', () => {
    const early = scoreActivities(rules(), [activity('a', '2026-11-02T12:00:00Z')], { asOf: '2026-11-02T12:10:00Z' });
    expect(early.excluded[0]?.reason).toBe('invalid_server_time');
    const result = scoreActivities(rules(), [activity('a', '2026-11-02T12:00:00Z', { receivedAt: '2026-11-02T12:00:00Z' })], AS_OF);
    expect(result.excluded[0]?.reason).toBe('invalid_server_time');
  });
  it('recomputação é independente da ordem de chegada', () => {
    const records = [activity('a', '2026-11-02T12:00:00Z'), activity('b', '2026-11-03T12:00:00Z'), activity('c', '2026-11-02T13:00:00Z')];
    const forward = scoreActivities(rules(), records, AS_OF);
    const reverse = scoreActivities(rules(), [...records].reverse(), AS_OF);
    expect(forward.users).toEqual(reverse.users);
  });
  it('excluir atividade remove o crédito em recomputação e não muda histórico de entrada', () => {
    const record = activity('a', '2026-11-02T12:00:00Z');
    expect(scoreActivities(rules(), [record], AS_OF).users[0]!.total).toBe(1);
    expect(scoreActivities(rules(), [{ ...record, deleted: true }], AS_OF).users[0]!.total).toBe(0);
    expect(record.deleted).toBeUndefined();
  });
});

describe('classificação e empates', () => {
  it('usa meta semanal fixa sem facilitar a semana incompleta', () => {
    const config = rules({ startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-09T00:00:00Z' });
    const result = scoreActivities(config, [activity('friday', '2026-11-06T12:00:00Z')], AS_OF);
    expect(result.users[0]!.weeks[0]).toMatchObject({ total: 1, goal: 5, met: false });
  });
  it('desempata por semanas cumpridas e depois compartilha posição com saltos', () => {
    const config = rules({ weeklyCap: 2, weeklyGoal: 2 });
    const records = [
      activity('a1', '2026-11-02T12:00:00Z'), activity('a2', '2026-11-03T12:00:00Z'),
      activity('b1', '2026-11-02T12:00:00Z', { userId: 'bob' }), activity('b2', '2026-11-03T12:00:00Z', { userId: 'bob' }),
      activity('c1', '2026-11-02T12:00:00Z', { userId: 'carol' }), activity('c2', '2026-11-09T12:00:00Z', { userId: 'carol' }),
    ];
    const result = scoreActivities(config, records, AS_OF);
    const participants = [{ userId: 'alice', displayName: 'Alice' }, { userId: 'bob', displayName: 'Beto' }, { userId: 'carol', displayName: 'Carol' }, { userId: 'dora', displayName: 'Dora' }];
    expect(classifyRanking(config, result, participants).map(entry => [entry.userId, entry.position, entry.weeksMet])).toEqual([
      ['alice', 1, 1], ['bob', 1, 1], ['carol', 3, 0], ['dora', 4, 0],
    ]);
    expect(classifyRanking({ ...config, tieBreak: 'shared' }, result, participants).map(entry => entry.position)).toEqual([1, 1, 1, 4]);
  });
  it('não inventa participantes sem dados nem expõe e-mails', () => {
    expect(classifyRanking(rules(), scoreActivities(rules(), [], AS_OF))).toEqual([]);
  });
});
