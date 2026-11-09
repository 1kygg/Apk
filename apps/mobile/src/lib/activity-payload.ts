import type {StoredActivity} from './storage';

/** Only summaries leave the device; never send coordinates or private filter state. */
export function completionPayload(activity:StoredActivity){
  const cardio=['walking','running','cycling'].includes(activity.modality);
  return {
    clientId:activity.clientId,activeSeconds:Math.floor(activity.activeSeconds),
    totalSeconds:Math.floor(activity.totalSeconds),
    ...(cardio?{distanceMeters:Math.round(activity.distanceMeters)}:{}),
    steps:['walking','running'].includes(activity.modality)&&activity.stepsReliable?activity.steps??undefined:undefined,
    completed:true as const,endedAt:activity.endedAt??undefined,notes:activity.notes||undefined,
    completedOffline:activity.endedOffline,anomalies:[...(activity.anomalies??[])],
  };
}
export function importPayload(activity:StoredActivity){
  const {completedOffline:_offline,...summary}=completionPayload(activity);
  return {...summary,modality:activity.modality,source:activity.source,environment:activity.environment,startedAt:activity.startedAt};
}
