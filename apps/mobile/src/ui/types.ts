export type Environment = 'home' | 'gym' | 'outdoor';
export type Modality = 'strength' | 'walking' | 'running' | 'cycling' | 'football' | 'basketball' | 'volleyball';
export type Preferences = {
  goal: 'health' | 'strength' | 'conditioning';
  level: 'beginner' | 'intermediate' | 'advanced';
  availableDays: number[];
  durationMinutes: number;
  environment: Environment;
  equipment: string[];
  modalities: Modality[];
  avoidExerciseIds: string[];
  timezone: string;
};
export type Exercise = {
  id: string; name: string; muscles: string[]; equipment: string[]; instructions: string[];
  environments?: Environment[]; level?: string; easierId?: string; substitutionIds?: string[];
  sets?: number; repetitions?: number; durationSeconds?: number; restSeconds?: number;
  media?: {kind: 'svg'; svg: string; license: string; author: string; description: string};
};
export type PlannedExercise = Exercise & { exerciseId: string; sets: number; restSeconds: number };
export type DayPlan = {
  id: string; date: string; environment: Environment; kind: 'training' | 'rest';
  focus: string; reason: string; warmup: string[]; exercises: PlannedExercise[];
  status?: 'draft' | 'started' | 'completed'; activityId?: string; startedAt?: string; completedAt?: string;
  cooldown?: string[]; safetyNote?: string; durationMinutes?: number;
  progress?: { sets: Record<string, boolean[]>; notes: string; adaptations: Record<string, { exerciseId?: string; sets?: number; repetitions?: number; durationSeconds?: number; note?: string }> };
};
export type Group = { id: string; name: string; description?: string; role?: string; myRole?: string };
export type Member = { userId: string; displayName: string; avatarUrl?: string; role: string };
export type Invite = { id: string; code?: string; expiresAt?: string; revokedAt?: string };
export type Rules = {
  type: 'consistency' | 'walking' | 'running' | 'cycling' | 'steps';
  startsAt: string; endsAt: string; timezone: string; validDays: number[]; makeupDays: number[];
  dailyCap: number; weeklyCap: number; pointsPerDay: number; weeklyGoal: number;
  weekStartsOn: number; allowedModalities: Modality[]; acceptedSources: string[];
  windowStartMinute?: number; windowEndMinute?: number; syncGraceHours: number;
  offlinePolicy: 'reject_scoring' | 'review'; tieBreak: 'weeks_met' | 'shared'; minimumActiveSeconds: number;
};
export type Challenge = {
  id: string; groupId: string; name: string; description?: string; rules: Rules; updatedAt?: string;
};
export type Activity = {
  id: string; clientId?: string; modality: Modality; source: string; environment?: string;
  startedAt: string; endedAt?: string; activeSeconds: number; totalSeconds?: number;
  distanceMeters?: number; steps?: number | null; status?: string; eligibility?: string;
  eligibilityReason?: string; ineligibleReason?: string; notes?: string; syncStatus?: string;
};
export const environmentLabels: Record<Environment, string> = { home: 'Casa', gym: 'Academia', outdoor: 'Ao ar livre' };
export const modalityLabels: Record<string, string> = { strength: 'Força', walking: 'Caminhada', running: 'Corrida', cycling: 'Ciclismo', football: 'Futebol', basketball: 'Basquete', volleyball: 'Vôlei' };
export const sourceLabels: Record<string, string> = { self_reported: 'Autodeclarado', gps: 'GPS', manual: 'Manual', health_connect: 'Health Connect', healthkit: 'HealthKit' };
export const days = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
export const equipmentOptions = ['elástico', 'mochila', 'garrafas', 'halteres', 'barra', 'banco', 'máquina', 'bicicleta'];
export function defaultPreferences(): Preferences {
  return { goal: 'health', level: 'beginner', availableDays: [1,3,5], durationMinutes: 25, environment: 'home', equipment: [], modalities: ['strength','walking'], avoidExerciseIds: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' };
}
export function formatTime(seconds = 0): string {
  const n = Math.max(0, Math.floor(seconds)); return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(x => String(x).padStart(2,'0')).join(':');
}
export function localDate(value?: string): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}
export function message(error: unknown): string { return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'; }
