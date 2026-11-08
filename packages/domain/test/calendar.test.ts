import { describe, expect, it } from 'vitest';
import { calendarDays, calculateMaximum, fitsTimeWindow, localDate, ProfilePreferencesSchema, validateRules, weekStartForDate } from '../src';
import { rules } from './fixtures';

describe('configurações e calendário real', () => {
  it('preenche defaults e normaliza instantes sem fixar datas de competição', () => {
    const parsed = rules({ startsAt: '2026-11-02T03:00:00+03:00' });
    expect(parsed.startsAt).toBe('2026-11-02T00:00:00.000Z');
    expect(parsed.weeklyGoal).toBe(5);
    expect(parsed.pointsPerDay).toBe(1);
    expect(parsed.makeupDays).toEqual([]);
  });
  it.each([
    { endsAt: '2026-11-01T00:00:00Z' },
    { timezone: 'Fuso/Inexistente' },
    { validDays: [] },
    { validDays: [1, 1] },
    { makeupDays: [1] },
    { dailyCap: 6 },
    { weeklyGoal: 6 },
    { windowStartMinute: 120 },
    { windowStartMinute: 120, windowEndMinute: 120 },
    { pointsPerDay: 2 },
    { dailyCap: 1e308, weeklyCap: 1e308 },
    { syncGraceHours: Number.MAX_SAFE_INTEGER },
  ])('recusa regras inconsistentes: %o', override => {
    expect(() => rules(override)).toThrow();
  });
  it('valida preferências sem presumir equipamento em casa', () => {
    const profile = ProfilePreferencesSchema.parse({
      goal: 'health', level: 'beginner', availableDays: [2, 4], durationMinutes: 20,
      environment: 'home', modalities: ['strength'], timezone: 'America/Sao_Paulo',
    });
    expect(profile.equipment).toEqual([]);
    expect(profile.avoidExerciseIds).toEqual([]);
  });
  it('mantém máximo finito para limites grandes representáveis', () => {
    const config = rules({ type: 'running', dailyCap: 1e12, weeklyCap: 5e12 });
    const maximum = calculateMaximum(config);
    expect(maximum.total).toBe(1e13);
    expect(Number.isFinite(maximum.total)).toBe(true);
  });
  it('calcula semanas incompletas e não cria uma semana extra na data final exclusiva', () => {
    const config = rules({ startsAt: '2026-11-04T12:00:00Z', endsAt: '2026-11-10T00:00:00Z' });
    const maximum = calculateMaximum(config);
    expect(maximum.total).toBe(4);
    expect(maximum.weeks.map(week => [week.weekStart, week.maximum])).toEqual([['2026-11-02', 3], ['2026-11-09', 1]]);
    expect(calendarDays(config).at(-1)?.date).toBe('2026-11-09');
  });
  it('não soma reposição ao máximo teórico', () => {
    const config = rules({ endsAt: '2026-11-09T00:00:00Z', validDays: [1, 3], makeupDays: [5, 6], weeklyCap: 3 });
    expect(calculateMaximum(config).total).toBe(2);
  });
  it('a semana pode começar em qualquer dia ISO', () => {
    expect(weekStartForDate('2026-11-02', 'UTC', 3)).toBe('2026-10-28');
    expect(weekStartForDate('2026-11-04', 'UTC', 3)).toBe('2026-11-04');
  });
  it('conta somente dias com interseção real com a janela', () => {
    const config = rules({
      startsAt: '2026-11-02T20:00:00Z', endsAt: '2026-11-03T08:00:00Z',
      windowStartMinute: 9 * 60, windowEndMinute: 10 * 60,
    });
    expect(calculateMaximum(config).total).toBe(0);
  });
  it('preserva datas locais atravessando início do horário de verão', () => {
    const config = rules({
      timezone: 'America/New_York', startsAt: '2026-03-07T05:00:00Z', endsAt: '2026-03-10T04:00:00Z',
      validDays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(calendarDays(config).map(day => day.date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(calculateMaximum(config).total).toBe(3);
  });
  it('não inventa minutos inexistentes em uma janela na transição de verão', () => {
    const config = rules({
      timezone: 'America/New_York', startsAt: '2026-03-08T05:00:00Z', endsAt: '2026-03-09T04:00:00Z',
      validDays: [7], windowStartMinute: 150, windowEndMinute: 195, minimumActiveSeconds: 20 * 60,
    });
    expect(calculateMaximum(config).total).toBe(0); // apenas 03:00–03:15 existe
    expect(calculateMaximum({ ...config, minimumActiveSeconds: 10 * 60 }).total).toBe(1);
  });
  it('inclui as duas ocorrências de uma janela ambígua no retorno do horário de verão', () => {
    const config = rules({
      timezone: 'America/New_York', startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-02T05:00:00Z',
      validDays: [7], windowStartMinute: 75, windowEndMinute: 105,
    });
    expect(fitsTimeWindow(config, '2026-11-01T05:20:00Z', '2026-11-01T06:40:00Z')).toBe(true);
  });
  it('atribui data pelo fuso do desafio e não pelo fuso do celular', () => {
    expect(localDate('2026-11-03T02:00:00Z', 'America/Sao_Paulo')).toBe('2026-11-02');
    expect(localDate('2026-11-03T02:00:00Z', 'Asia/Tokyo')).toBe('2026-11-03');
  });
  it('mede máximos de quilometragem em km e passos em unidades inteiras', () => {
    const distance = rules({ type: 'running', dailyCap: 10, weeklyCap: 30, weeklyGoal: 30 });
    expect(calculateMaximum(distance)).toMatchObject({ total: 60, unit: 'kilometers' });
    expect(() => rules({ type: 'steps', dailyCap: 2.5, weeklyCap: 10 })).toThrow();
  });
});
