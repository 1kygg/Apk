import type { StoredActivity } from './storage';
export const CLOCK_GAP_MS = 30000;
export function advanceRecordingClock(activity: StoredActivity, wallNow: number, monotonicNow: number, runtimeId: string): StoredActivity {
  if (activity.status !== 'recording' && activity.status !== 'paused') return activity;
  const wallDelta = wallNow - activity.lastTickAt;
  const monoDelta = monotonicNow - activity.lastMonotonic;
  // A restarted process, a large gap or changed device clock requires explicit user resumption.
  // No duration is invented for the unobserved interval.
  if (activity.runtimeId !== runtimeId || wallDelta < 0 || monoDelta < 0 ||
      (activity.status === 'recording' && wallDelta > CLOCK_GAP_MS) || Math.abs(wallDelta-monoDelta) > 5000) {
    return {
      ...activity, status:'interrupted', signal:'lost',
      stepsReliable:false,
      eligibilityReason:'Registro interrompido. O período sem registro não foi acrescentado.',
      lastTickAt:wallNow,lastMonotonic:monotonicNow,runtimeId,
    };
  }
  const seconds = Math.max(0,monoDelta/1000);
  return {
    ...activity,
    totalSeconds:activity.totalSeconds+seconds,
    activeSeconds:activity.activeSeconds+(activity.status==='recording'?seconds:0),
    pauseSeconds:activity.pauseSeconds+(activity.status==='paused'?seconds:0),
    lastTickAt:wallNow,lastMonotonic:monotonicNow,
  };
}
export function activityMetrics(activity: {distanceMeters:number;activeSeconds:number}) {
  const kilometers=activity.distanceMeters/1000;
  return {
    kilometers,
    paceSecondsPerKm:kilometers>0?activity.activeSeconds/kilometers:null,
    speedKmh:activity.activeSeconds>0?kilometers/(activity.activeSeconds/3600):null,
    timingBasis:'active' as const,
  };
}
