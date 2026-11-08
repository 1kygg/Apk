export type CardioModality = 'walking' | 'running' | 'cycling';
export type Modality = CardioModality | 'strength' | 'football' | 'basketball' | 'volleyball' | 'other';
export type Environment = 'home' | 'gym' | 'outdoor';
export type ActivitySource = 'gps' | 'manual' | 'self_reported';
export interface User { id: string; displayName: string; avatarUrl?: string | null }
export interface Session { accessToken: string; user: User; offline?: boolean }
export type SyncStatus = 'device_only' | 'pending' | 'server_confirmed' | 'ineligible';
export interface RoutePoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  segment: number;
}
export interface LocalActivity {
  id: string;
  clientId: string;
  ownerId: string;
  serverId: string | null;
  modality: Modality;
  source: ActivitySource;
  environment: Environment;
  startedAt: string;
  endedAt: string | null;
  status: 'recording' | 'paused' | 'interrupted' | 'review' | 'saved';
  syncStatus: SyncStatus;
  distanceMeters: number;
  activeSeconds: number;
  totalSeconds: number;
  pauseSeconds: number;
  steps: number | null;
  stepsReliable: boolean;
  stepSource: string | null;
  stepsLastSyncedAt: string | null;
  signal: 'searching' | 'good' | 'weak' | 'lost' | 'permission_denied';
  eligibilityReason: string | null;
  notes: string;
  pointCount: number;
  backgroundEnabled: boolean;
}
export interface TrackerState {
  activity: LocalActivity | null;
  route: RoutePoint[];
  backgroundEnabled: boolean;
  error: string | null;
  syncing: boolean;
}
export interface StepSummary {
  steps: number | null;
  source: string | null;
  lastSyncedAt: string | null;
  message: string;
}
export interface ReminderPreferences {
  enabled: boolean;
  days: number[];
  hour: number;
  minute: number;
  quietStart?: string;
  quietEnd?: string;
}
