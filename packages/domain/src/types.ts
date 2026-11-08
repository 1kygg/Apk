import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';

// Resource guard for materialized calendar previews/recomputation, not a competition preset.
export const MAX_CALENDAR_DAYS = 100_000;

export const ModalitySchema = z.enum(['strength', 'walking', 'running', 'cycling', 'football', 'basketball', 'volleyball']);
export type Modality = z.infer<typeof ModalitySchema>;
export const ActivitySourceSchema = z.enum(['self_reported', 'gps', 'manual', 'health_connect', 'healthkit']);
export type ActivitySource = z.infer<typeof ActivitySourceSchema>;
export const EnvironmentSchema = z.enum(['home', 'gym', 'outdoor']);
export type Environment = z.infer<typeof EnvironmentSchema>;
export const IsoWeekdaySchema = z.number().int().min(1).max(7);
const uniqueDays = z.array(IsoWeekdaySchema).max(7).refine(days => new Set(days).size === days.length, 'Dias repetidos.');
const timezone = z.string().refine(value => IANAZone.isValidZone(value), 'Informe um fuso IANA válido.');
const timestamp = z.string().datetime({ offset: true }).refine(value => DateTime.fromISO(value, { setZone: true }).isValid, 'Data inválida.')
  .transform(value => DateTime.fromISO(value, { setZone: true }).toUTC().toISO()!);
const positive = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegative = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ProfilePreferencesSchema = z.object({
  goal: z.enum(['health', 'strength', 'conditioning']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  availableDays: uniqueDays.refine(days => days.length > 0, 'Escolha pelo menos um dia.'),
  durationMinutes: z.number().int().positive().max(1440),
  environment: EnvironmentSchema,
  equipment: z.array(z.string().min(1)).default([]),
  modalities: z.array(ModalitySchema).min(1).refine(values => new Set(values).size === values.length, 'Modalidades repetidas.'),
  avoidExerciseIds: z.array(z.string().min(1)).default([]),
  timezone,
});
export type ProfilePreferences = z.output<typeof ProfilePreferencesSchema>;

const RulesObjectSchema = z.object({
  type: z.enum(['consistency', 'walking', 'running', 'cycling', 'steps']),
  startsAt: timestamp,
  endsAt: timestamp,
  timezone,
  validDays: uniqueDays.refine(days => days.length > 0, 'Escolha pelo menos um dia válido.'),
  makeupDays: uniqueDays.default([]),
  dailyCap: positive,
  weeklyCap: positive,
  pointsPerDay: positive.default(1),
  weeklyGoal: positive.optional(),
  weekStartsOn: IsoWeekdaySchema,
  allowedModalities: z.array(ModalitySchema).min(1).refine(values => new Set(values).size === values.length, 'Modalidades repetidas.'),
  acceptedSources: z.array(ActivitySourceSchema).min(1).refine(values => new Set(values).size === values.length, 'Fontes repetidas.'),
  windowStartMinute: z.number().int().min(0).max(1439).optional(),
  windowEndMinute: z.number().int().min(0).max(1439).optional(),
  syncGraceHours: nonnegative,
  offlinePolicy: z.enum(['reject_scoring', 'review']),
  tieBreak: z.enum(['weeks_met', 'shared']),
  minimumActiveSeconds: nonnegative.default(0),
});

/** Validated challenge rules. Distances and distance caps use kilometers; steps are counts. */
export const ChallengeRulesSchema = RulesObjectSchema.superRefine((rules, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (DateTime.fromISO(rules.endsAt).toMillis() <= DateTime.fromISO(rules.startsAt).toMillis()) issue('endsAt', 'O encerramento deve ser posterior ao início.');
  const firstDate = DateTime.fromISO(rules.startsAt).setZone(rules.timezone).startOf('day');
  const lastDate = DateTime.fromISO(rules.endsAt).minus({ milliseconds: 1 }).setZone(rules.timezone).startOf('day');
  if (lastDate.diff(firstDate, 'days').days + 1 > MAX_CALENDAR_DAYS) issue('endsAt', 'O período excede o limite técnico de processamento do calendário. Reduza o intervalo.');
  if (!DateTime.fromISO(rules.endsAt).plus({ hours: rules.syncGraceHours }).isValid) issue('syncGraceHours', 'O prazo de sincronização excede o intervalo de datas representável.');
  if (rules.dailyCap > rules.weeklyCap) issue('dailyCap', 'O limite diário não pode exceder o semanal.');
  if ((rules.weeklyGoal ?? rules.weeklyCap) > rules.weeklyCap) issue('weeklyGoal', 'A meta semanal não pode exceder o limite semanal.');
  if (rules.makeupDays.some(day => rules.validDays.includes(day))) issue('makeupDays', 'Dias regulares e de reposição devem ser diferentes.');
  if ((rules.windowStartMinute === undefined) !== (rules.windowEndMinute === undefined)) issue('windowStartMinute', 'Defina início e fim da janela juntos.');
  if (rules.windowStartMinute !== undefined && rules.windowStartMinute === rules.windowEndMinute) issue('windowEndMinute', 'Para o dia inteiro, remova a janela.');
  if (rules.type === 'consistency' && rules.pointsPerDay > rules.dailyCap) issue('pointsPerDay', 'Os pontos por dia não podem exceder o limite diário.');
  if (['walking', 'running', 'cycling'].includes(rules.type) && !rules.allowedModalities.includes(rules.type as Modality)) issue('allowedModalities', 'A modalidade da classificação deve ser aceita.');
  if (rules.type === 'steps' && !rules.allowedModalities.some(modality => modality === 'walking' || modality === 'running')) issue('allowedModalities', 'Passos exigem caminhada ou corrida.');
  if (rules.type === 'steps' && (!Number.isInteger(rules.dailyCap) || !Number.isInteger(rules.weeklyCap) || (rules.weeklyGoal !== undefined && !Number.isInteger(rules.weeklyGoal)))) issue('dailyCap', 'Limites e metas de passos devem ser inteiros.');
}).transform(rules => ({ ...rules, weeklyGoal: rules.weeklyGoal ?? rules.weeklyCap }));
export type ChallengeRules = z.output<typeof ChallengeRulesSchema>;
export type ChallengeRulesInput = z.input<typeof ChallengeRulesSchema>;

export const ActivityRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  modality: ModalitySchema,
  source: ActivitySourceSchema,
  eligibility: z.enum(['verified', 'pending_review', 'ineligible']),
  verifiedStartAt: timestamp.nullable(),
  verifiedEndAt: timestamp.nullable(),
  receivedAt: timestamp,
  activeSeconds: nonnegative,
  distanceMeters: nonnegative.optional(),
  steps: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  completed: z.boolean(),
  deleted: z.boolean().optional(),
});
export type ActivityRecord = z.output<typeof ActivityRecordSchema>;
export type ScoreUnit = 'points' | 'kilometers' | 'steps';
export interface WeekMaximum { weekStart: string; regularDates: string[]; maximum: number }
export interface MaximumResult { total: number; unit: ScoreUnit; weeks: WeekMaximum[] }
export interface ScoreCredit {
  activityId: string;
  userId: string;
  date: string;
  weekStart: string;
  value: number;
  kind: 'regular' | 'makeup';
  recoveredDate?: string;
}
export interface WeekScore { weekStart: string; total: number; goal: number; met: boolean }
export interface UserScore { userId: string; total: number; weeksMet: number; weeks: WeekScore[]; credits: ScoreCredit[] }
export interface ScoreExclusion { activityId: string; userId: string; reason: string }
export interface ScoringResult { unit: ScoreUnit; users: UserScore[]; excluded: ScoreExclusion[]; asOf: string }
export interface RankingParticipant { userId: string; displayName: string; avatarUrl?: string }
export interface RankingEntry extends RankingParticipant { position: number; total: number; weeksMet: number }

/** Parse at the backend boundary. Unknown client fields do not influence scoring. */
export function validateRules(input: unknown): ChallengeRules { return ChallengeRulesSchema.parse(input); }
