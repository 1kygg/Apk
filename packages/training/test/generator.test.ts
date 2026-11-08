import { describe,it,expect } from "vitest";
import type { ProfilePreferences } from "@consta/domain";
import { EXERCISES, applySubstitution, generatePlan, getCompatibleSubstitutions, getExercise, isExerciseCompatible, type TrainingHistorySession } from "../src";

const profile: ProfilePreferences = {
  goal:"strength",level:"beginner",availableDays:[1,2,3,4,5,6,7],durationMinutes:30,
  environment:"home",equipment:[],modalities:["strength"],avoidExerciseIds:[],timezone:"America/Sao_Paulo"
};
describe("structured exercise library",()=>{
  it("contains original media and fully resolved alternatives",()=>{
    expect(EXERCISES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(EXERCISES.map(exercise=>exercise.id)).size).toBe(EXERCISES.length);
    for(const exercise of EXERCISES) {
      expect(exercise.instructions.length).toBeGreaterThanOrEqual(2);
      expect(exercise.muscles.length).toBeGreaterThan(0);
      expect(getExercise(exercise.easierId)).toBeDefined();
      for(const id of exercise.substitutionIds) expect(getExercise(id)).toBeDefined();
      expect(exercise.media.license).toBe("CC0-1.0");
      expect(exercise.media.svg).toContain("<svg");
      expect(exercise.media.svg).not.toMatch(/(?:href|src)=/);
      expect(exercise.repetitions ?? exercise.durationSeconds).toBeGreaterThan(0);
    }
  });
  it("does not select unavailable material or advanced exercises",()=>{
    const plan=generatePlan(profile,"2026-11-09",[]);
    expect(plan.kind).toBe("training");
    expect(plan.exercises.every(exercise=>exercise.equipment.length===0)).toBe(true);
    expect(plan.exercises.every(exercise=>isExerciseCompatible(getExercise(exercise.exerciseId)!,profile))).toBe(true);
    const gym={...profile,environment:"gym" as const,equipment:["dumbbell","bench","seated_row"]};
    const gymPlan=generatePlan(gym,"2026-11-09",[]);
    expect(gymPlan.exercises.every(exercise=>exercise.equipment.every(item=>gym.equipment.includes(item)))).toBe(true);
  });
});
describe("daily planning",()=>{
  it("is deterministic and leaves inputs unchanged",()=>{
    const before=JSON.stringify(profile);
    expect(generatePlan(profile,"2026-11-09",[])).toEqual(generatePlan(profile,"2026-11-09",[]));
    expect(JSON.stringify(profile)).toBe(before);
  });
  it("respects available days and rejects invalid calendar dates",()=>{
    expect(generatePlan({...profile,availableDays:[1]},"2026-11-08",[]).kind).toBe("rest");
    expect(()=>generatePlan(profile,"2026-02-30",[])).toThrow("Data");
  });
  it("filters avoided movements in suggestions and substitutions",()=>{
    const preferences={...profile,avoidExerciseIds:["squat-bodyweight","knee-pushup","wall-pushup"]};
    const plan=generatePlan(preferences,"2026-11-09",[]);
    expect(plan.exercises.some(exercise=>preferences.avoidExerciseIds.includes(exercise.exerciseId))).toBe(false);
    expect(getCompatibleSubstitutions(preferences,"pushup").some(exercise=>preferences.avoidExerciseIds.includes(exercise.id))).toBe(false);
  });
  it("uses recent recovery groups and suggests rest when no safe variety remains",()=>{
    const history: TrainingHistorySession[]=[{completedAt:"2026-11-08T21:00:00Z",exerciseIds:[],recoveryGroups:["quadriceps","posterior","chest","back","shoulders","core","calves"],intensity:"moderate"}];
    expect(generatePlan(profile,"2026-11-09",history).kind).toBe("rest");
    const onlySquat:TrainingHistorySession[]=[{completedAt:"2026-11-08T21:00:00Z",exerciseIds:["squat-bodyweight"],intensity:"moderate"}];
    const plan=generatePlan(profile,"2026-11-09",onlySquat);
    expect(plan.kind).toBe("training");
    expect(plan.exercises.every(exercise=>!exercise.recoveryGroups.includes("quadriceps"))).toBe(true);
  });
  it("keeps planned anchors and rotates recent accessories without changing intensity scoring",()=>{
    const first=generatePlan(profile,"2026-11-09",[]);
    const history: TrainingHistorySession[]=[{completedAt:"2026-11-09T21:00:00Z",exerciseIds:first.exercises.map(exercise=>exercise.exerciseId),intensity:"moderate"}];
    const next=generatePlan(profile,"2026-11-16",history);
    expect(next.exercises.slice(0,2).map(exercise=>exercise.exerciseId)).toEqual(first.exercises.slice(0,2).map(exercise=>exercise.exerciseId));
    expect(next.exercises[2]!.exerciseId).not.toBe(first.exercises[2]!.exerciseId);
    expect(next.reason).toContain("não reduz pontos");
  });
  it("uses the profile timezone for recovery, not the UTC date",()=>{
    const history:TrainingHistorySession[]=[{completedAt:"2026-11-09T01:00:00Z",exerciseIds:["squat-bodyweight"],intensity:"moderate"}];
    const plan=generatePlan({...profile,goal:"health"},"2026-11-10",history);
    expect(plan.exercises.some(exercise=>exercise.pattern==="squat")).toBe(true);
  });
  it("respects preferred indoor cardio and labels equipment distance as manual",()=>{
    const plan=generatePlan({...profile,environment:"gym",modalities:["walking"],equipment:["treadmill"]},"2026-11-09",[]);
    expect(plan.kind).toBe("training");
    expect(plan.exercises).toHaveLength(1);
    expect(getExercise(plan.exercises[0]!.exerciseId)?.modality).toBe("walking");
    expect(plan.reason).toContain("manuais");
  });
  it("requires a bicycle for outdoor cycling, and does not invent GPS data",()=>{
    const preferences={...profile,environment:"outdoor" as const,modalities:["cycling"] as ProfilePreferences["modalities"]};
    const without=generatePlan(preferences,"2026-11-09",[]);
    expect(without.exercises.some(exercise=>exercise.exerciseId==="cycling")).toBe(false);
    const withBike=generatePlan({...preferences,equipment:["bicycle"]},"2026-11-09",[]);
    expect(withBike.exercises[0]?.exerciseId).toBe("cycling");
    expect(withBike.reason).toContain("GPS");
  });
});
describe("substitutions and snapshots",()=>{
  it("replaces a compatible draft slot without mutating the original version",()=>{
    const plan=generatePlan(profile,"2026-11-09",[]);
    plan.status="draft";
    const slot=plan.exercises.find(exercise=>exercise.pattern==="squat")!;
    const before=structuredClone(plan);
    const replacement=getCompatibleSubstitutions(profile,slot.exerciseId)[0]!;
    const next=applySubstitution(plan,slot.id,replacement.id,profile);
    expect(plan).toEqual(before);
    expect(next.exercises.find(exercise=>exercise.id===slot.id)?.exerciseId).toBe(replacement.id);
    expect(next.exercises.find(exercise=>exercise.id===slot.id)?.id).toBe(slot.id);
  });
  it("rejects missing equipment, unrelated patterns, and editing an already started version",()=>{
    const plan=generatePlan(profile,"2026-11-09",[]);
    const slot=plan.exercises.find(exercise=>exercise.pattern==="squat")!;
    expect(()=>applySubstitution(plan,slot.id,"leg-press",profile)).toThrow("incompatível");
    expect(()=>applySubstitution(plan,slot.id,"wall-pushup",profile)).toThrow("incompatível");
    plan.status="started";
    expect(()=>applySubstitution(plan,slot.id,"squat-supported",profile)).toThrow("imutável");
  });
});
