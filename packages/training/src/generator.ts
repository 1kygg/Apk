import { localDate, type ProfilePreferences } from "@consta/domain";
import { EXERCISES, getExercise } from "./library";
import type { DayPlan, Exercise, MovementPattern, PlannedExercise, RecoveryGroup, TrainingHistorySession } from "./types";

const levels = { beginner: 0, intermediate: 1, advanced: 2 };
const safetyNote = "Sugestão geral de atividade, não avaliação médica ou prescrição clínica. Ajuste a sessão ao seu conforto e interrompa em caso de dor ou mal-estar. A conclusão é autodeclarada e pode usar uma versão adaptada, com menos séries ou movimentos mais fáceis.";
export function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T12:00:00Z")) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("Data local inválida.");
}
function weekday(date: string): number { const day = new Date(date + "T12:00:00Z").getUTCDay(); return day === 0 ? 7 : day; }
function daysApart(later: string, earlier: string): number { return Math.floor((Date.parse(later + "T12:00:00Z") - Date.parse(earlier + "T12:00:00Z")) / 86400000); }
function hash(input: string): number { let value = 2166136261; for (let i=0; i<input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), 16777619); return value >>> 0; }
function historyDate(session: TrainingHistorySession, timezone: string): string | null {
  try { const date = localDate(session.completedAt, timezone); assertDate(date); return date; } catch { return null; }
}
export function isExerciseCompatible(exercise: Exercise, profile: ProfilePreferences): boolean {
  return exercise.environments.includes(profile.environment)
    && levels[exercise.level] <= levels[profile.level]
    && exercise.equipment.every(item => profile.equipment.includes(item))
    && !profile.avoidExerciseIds.includes(exercise.id);
}
export function getCompatibleSubstitutions(profile: ProfilePreferences, exerciseId: string): Exercise[] {
  const source = getExercise(exerciseId);
  if (!source) return [];
  return EXERCISES.filter(candidate => candidate.id !== source.id
    && (candidate.pattern === source.pattern && candidate.modality === source.modality || source.easierId === candidate.id)
    && isExerciseCompatible(candidate, profile));
}
export function toPlannedExercise(exercise: Exercise, slot: number | string, sets: number = exercise.sets): PlannedExercise {
  return {
    id: String(slot), exerciseId: exercise.id, name: exercise.name,
    muscles: [...exercise.muscles], equipment: [...exercise.equipment], instructions: [...exercise.instructions],
    sets, repetitions: exercise.repetitions, durationSeconds: exercise.durationSeconds,
    restSeconds: exercise.restSeconds, easierId: exercise.easierId,
    substitutionIds: [...exercise.substitutionIds], pattern: exercise.pattern,
    recoveryGroups: [...exercise.recoveryGroups]
  };
}
export function applySubstitution(plan: DayPlan, exerciseOrSlotId: string, replacementId: string, profile: ProfilePreferences): DayPlan {
  if (plan.status && plan.status !== "draft") throw new Error("A versão iniciada é imutável. Registre uma adaptação na execução.");
  const index = plan.exercises.findIndex(exercise => exercise.id === exerciseOrSlotId || exercise.exerciseId === exerciseOrSlotId);
  if (index < 0) throw new Error("Exercício não encontrado na sessão.");
  const original = plan.exercises[index]!;
  const scoped = { ...profile, environment: plan.environment };
  const replacement = getCompatibleSubstitutions(scoped, original.exerciseId).find(exercise => exercise.id === replacementId);
  if (!replacement) throw new Error("Alternativa incompatível com o movimento, nível, materiais ou exercícios evitados.");
  const next: DayPlan = structuredClone(plan);
  const item = toPlannedExercise(replacement, original.id, original.sets);
  if (original.durationSeconds && item.durationSeconds) item.durationSeconds = original.durationSeconds;
  item.substitutionIds = getCompatibleSubstitutions(scoped, replacement.id).map(exercise => exercise.id);
  next.exercises[index] = item;
  return next;
}
function recentRecovery(profile: ProfilePreferences, date: string, history: TrainingHistorySession[]): Set<RecoveryGroup> {
  const blocked = new Set<RecoveryGroup>();
  for (const session of history) {
    const completedDate = historyDate(session, profile.timezone);
    if (!completedDate || session.intensity === "easy") continue;
    const gap = daysApart(date, completedDate);
    if (gap < 0 || gap >= 2) continue;
    for (const group of session.recoveryGroups ?? []) blocked.add(group);
    for (const id of session.exerciseIds) for (const group of getExercise(id)?.recoveryGroups ?? []) blocked.add(group);
  }
  return blocked;
}
function rest(profile: ProfilePreferences, date: string, reason: string): DayPlan {
  return {
    id: "suggestion:" + date + ":" + profile.environment, date, environment: profile.environment,
    kind: "rest", focus: "Recuperação", reason,
    warmup: [], cooldown: [], safetyNote, durationMinutes: 0, exercises: []
  };
}
function estimateSeconds(exercises: PlannedExercise[]): number {
  return exercises.reduce((total, item) => total + item.sets * (item.durationSeconds ?? (item.repetitions ?? 8) * 4) + Math.max(0, item.sets - 1) * item.restSeconds + 25, 0);
}
function anchors(profile: ProfilePreferences): Record<string,string> {
  const has = (id: string) => profile.equipment.includes(id);
  return {
    squat: profile.environment === "gym" && has("leg_press") ? "leg-press" : has("dumbbell") ? "goblet-squat" : "squat-bodyweight",
    hinge: has("dumbbell") && profile.level !== "beginner" ? "dumbbell-rdl" : has("backpack") && profile.environment === "home" ? "backpack-deadlift" : "glute-bridge",
    push: profile.environment === "gym" && has("chest_press") ? "chest-press" : profile.level === "beginner" ? "wall-pushup" : profile.level === "intermediate" ? "knee-pushup" : "pushup",
    pull: profile.environment === "gym" && has("seated_row") ? "seated-row" : has("band") ? "band-row" : has("dumbbell") ? "dumbbell-row" : has("backpack") ? "backpack-row" : "prone-pull"
  };
}
/** Pure deterministic suggestion. The API assigns a server UUID and persists it once.
 * Calendar days, profile, recovery and planned movement anchors determine selection;
 * opening the application never regenerates an existing saved plan.
 */
export function generatePlan(profile: ProfilePreferences, date: string, recentSessions: TrainingHistorySession[] = []): DayPlan {
  assertDate(date);
  const day = weekday(date);
  if (!profile.availableDays.includes(day)) return rest(profile, date, "Hoje está livre na sua agenda pessoal. Descanso também faz parte do planejamento; a agenda não altera o calendário dos desafios.");
  const blocked = recentRecovery(profile, date, recentSessions);
  const minutes = Math.max(10, Math.min(120, Math.round(profile.durationMinutes)));
  const base: DayPlan = {
    id: "suggestion:" + date + ":" + profile.environment, date, environment: profile.environment, kind: "training",
    focus: "", reason: "", durationMinutes: minutes, safetyNote,
    warmup: ["Comece com 3 a 5 minutos de movimento leve, em ritmo confortável.", "Faça movimentos curtos dos exercícios da sessão, sem carga ou com carga leve."],
    cooldown: ["Desacelere por 2 a 3 minutos e respire normalmente.", "Hidrate-se e registre como se sentiu. Alongamentos suaves são opcionais."],
    exercises: []
  };
  if (profile.environment === "outdoor") {
    const candidates = EXERCISES.filter(exercise => (exercise.pattern === "locomotion" || exercise.pattern === "sport") && exercise.id !== "march" && isExerciseCompatible(exercise, profile));
    const preferred = candidates.filter(exercise => profile.modalities.includes(exercise.modality));
    const options = preferred.length ? preferred : candidates.filter(exercise => exercise.modality === "walking");
    if (!options.length) return rest(profile, date, "Não há uma modalidade ao ar livre compatível com as preferências e os materiais atuais. Ajuste suas preferências ou descanse.");
    const needsRecovery = blocked.has("quadriceps") || blocked.has("posterior") || blocked.has("calves");
    if (needsRecovery && !options.some(exercise => exercise.modality === "walking")) return rest(profile, date, "As sessões recentes usaram os mesmos grupos. Hoje a sugestão é recuperar; uma caminhada leve opcional pode ser feita sem obrigação de pontuar.");
    const available = needsRecovery ? options.filter(exercise => exercise.modality === "walking") : options;
    const ranked = [...available].sort((a,b) => {
      const score = (exercise: Exercise) => (exercise.id === "run" && profile.level !== "beginner" ? 20 : 0) + hash(date + exercise.modality) % 17;
      return score(b) - score(a) || a.id.localeCompare(b.id);
    });
    const selected = ranked[0]!;
    const planned = toPlannedExercise(selected, "slot-1", 1);
    planned.durationSeconds = Math.max(300, (minutes - 5) * 60);
    planned.substitutionIds = getCompatibleSubstitutions(profile, selected.id).map(exercise => exercise.id);
    base.exercises = [planned]; base.focus = selected.name;
    base.reason = needsRecovery ? "Caminhada leve para alternar com a carga recente. Adapte a duração e use pausas." : "Modalidade compatível com sua agenda, preferências e materiais. Para medir percurso e quilômetros, inicie o GPS na aba Atividades; concluir esta sugestão é autodeclarado.";
    return base;
  }
  if (!profile.modalities.includes("strength")) {
    const indoor = EXERCISES.filter(exercise => exercise.pattern === "locomotion" && isExerciseCompatible(exercise, profile) && profile.modalities.includes(exercise.modality));
    if (!indoor.length) return rest(profile, date, "Não há modalidade compatível com os materiais e preferências atuais. Você pode atualizar as preferências ou descansar.");
    if (blocked.has("quadriceps") || blocked.has("posterior")) return rest(profile, date, "Hoje sugerimos recuperação dos grupos usados recentemente. Uma atividade leve opcional não é obrigação.");
    indoor.sort((a,b)=> hash(date + b.id) - hash(date + a.id));
    const chosen = indoor[0]!;
    const item = toPlannedExercise(chosen, "slot-1", 1);
    item.durationSeconds = Math.max(300, (minutes - 5) * 60);
    item.substitutionIds = getCompatibleSubstitutions(profile, chosen.id).map(exercise => exercise.id);
    base.exercises = [item]; base.focus = chosen.name;
    base.reason = "Modalidade compatível com suas preferências. O registro é autodeclarado: duração e distância de equipamentos são manuais, sem medição de quilômetros por GPS.";
    return base;
  }
  const candidates = EXERCISES.filter(exercise => exercise.modality === "strength" && exercise.pattern !== "mobility" && isExerciseCompatible(exercise, profile) && !exercise.recoveryGroups.some(group => blocked.has(group)));
  const availablePatterns = new Set(candidates.map(exercise => exercise.pattern));
  if (availablePatterns.size < 2) return rest(profile, date, "A carga recente deixa poucas opções compatíveis para alternar grupos musculares. Hoje a sugestão é recuperação, com mobilidade leve opcional e sem obrigação de pontuar.");
  const availableIndex = [...new Set(profile.availableDays)].sort((a,b)=>a-b).indexOf(day);
  const upperDay = availableIndex % 2 === 1;
  const main: MovementPattern[] = upperDay ? ["push","pull","core","shoulders","calves","squat","hinge"] : ["squat","hinge","push","pull","core","calves","shoulders"];
  const patternOrder = profile.goal === "health" ? ["squat","push","hinge","pull", hash(date) % 2 ? "core" : "calves","shoulders"] as MovementPattern[] : main;
  const count = minutes < 20 ? 3 : minutes < 35 ? 4 : 5;
  const recentIds = new Set(recentSessions.filter(session => {
    const prior = historyDate(session, profile.timezone); return prior && daysApart(date, prior) >= 0 && daysApart(date, prior) <= 8;
  }).flatMap(session => session.exerciseIds));
  const anchorIds = anchors(profile);
  for (const pattern of patternOrder) {
    const choices = candidates.filter(exercise => exercise.pattern === pattern);
    if (!choices.length) continue;
    const isAnchor = base.exercises.length < 2;
    choices.sort((a,b) => {
      const score = (exercise: Exercise) => (isAnchor && exercise.id === anchorIds[pattern] ? 100 : 0)
        + (exercise.level === profile.level ? 8 : 2)
        + (profile.environment === "gym" && exercise.equipment.length ? 5 : 0)
        - (!isAnchor && recentIds.has(exercise.id) ? 9 : 0)
        + (!isAnchor ? hash(date + ":" + exercise.id) % 7 : 0);
      return score(b) - score(a) || a.id.localeCompare(b.id);
    });
    const chosen = choices[0]!;
    const sets = minutes < 20 ? 1 : profile.level === "beginner" ? 2 : 3;
    const planned = toPlannedExercise(chosen, "slot-" + (base.exercises.length + 1), sets);
    planned.substitutionIds = getCompatibleSubstitutions(profile, chosen.id).filter(exercise => !exercise.recoveryGroups.some(group => blocked.has(group))).map(exercise => exercise.id);
    // Keep familiar anchors. A small repetition progression is only suggested
    // after two recent completions of the same movement, never by adding points.
    const prior = recentSessions.filter(session => session.exerciseIds.includes(chosen.id));
    if (isAnchor && planned.repetitions && prior.length >= 2 && profile.level !== "beginner") planned.repetitions = Math.min(15, planned.repetitions + 1);
    base.exercises.push(planned);
    if (base.exercises.length >= count) break;
  }
  const budget = Math.max(120, (minutes - 5) * 60);
  while (estimateSeconds(base.exercises) > budget) {
    const adjustable = [...base.exercises].reverse().find(exercise => exercise.sets > 1);
    if (adjustable) adjustable.sets--; else if (base.exercises.length > 2) base.exercises.pop(); else break;
  }
  base.focus = upperDay && profile.goal !== "health" ? "Parte superior e estabilidade" : "Força e movimentos essenciais";
  base.reason = "Sugestão para seu nível, tempo e materiais. Movimentos principais se repetem para acompanhar evolução, com acessórios alternados e recuperação considerada. Reduzir séries ou usar alternativas mais fáceis não reduz pontos de constância.";
  return base;
}
