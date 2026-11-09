import type { ProfilePreferences } from "@consta/domain";

export type TrainingEnvironment = ProfilePreferences["environment"];
export type ExperienceLevel = ProfilePreferences["level"];
export type MovementPattern = "squat" | "hinge" | "push" | "pull" | "shoulders" | "core" | "calves" | "locomotion" | "sport" | "mobility";
export type RecoveryGroup = "quadriceps" | "posterior" | "chest" | "back" | "shoulders" | "core" | "calves";
export interface Exercise {
  id: string;
  name: string;
  muscles: string[];
  equipment: string[];
  environments: TrainingEnvironment[];
  instructions: string[];
  sets: number;
  repetitions?: number;
  durationSeconds?: number;
  restSeconds: number;
  easierId: string;
  substitutionIds: string[];
  pattern: MovementPattern;
  recoveryGroups: RecoveryGroup[];
  level: ExperienceLevel;
  modality: ProfilePreferences["modalities"][number];
  media: { kind: "svg"; svg: string; license: "CC0-1.0"; author: "Consta"; description: string };
}
export interface PlannedExercise {
  /** Stable slot identifier: use it to mark sets and record adaptations. */
  id: string;
  exerciseId: string;
  name: string;
  muscles: string[];
  equipment: string[];
  instructions: string[];
  sets: number;
  repetitions?: number;
  durationSeconds?: number;
  restSeconds: number;
  easierId?: string;
  substitutionIds: string[];
  pattern: MovementPattern;
  recoveryGroups: RecoveryGroup[];
}
export interface ExerciseAdaptation {
  exerciseId?: string;
  restSeconds?: number;
  sets?: number;
  repetitions?: number;
  durationSeconds?: number;
  note?: string;
}
export interface PlanProgress {
  sets: Record<string, boolean[]>;
  adaptations: Record<string, ExerciseAdaptation>;
  notes: string;
}
export interface DayPlan {
  id: string;
  date: string;
  environment: TrainingEnvironment;
  kind: "training" | "rest";
  focus: string;
  reason: string;
  warmup: string[];
  cooldown: string[];
  safetyNote: string;
  durationMinutes: number;
  exercises: PlannedExercise[];
  status?: "draft" | "started" | "completed";
  activityId?: string;
  progress?: PlanProgress;
  /** Original version is never replaced by execution adaptations. */
  startedSnapshot?: DayPlan;
}
export interface TrainingHistorySession {
  completedAt: string;
  exerciseIds: string[];
  recoveryGroups?: RecoveryGroup[];
  intensity?: "easy" | "moderate" | "hard";
  completedSets?: Record<string, number>;
  repetitions?: Record<string, number>;
}
