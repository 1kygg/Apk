export interface Coordinates { latitude: number; longitude: number }
export interface GpsPoint extends Coordinates {
  /** Horizontal accuracy in meters, as provided by the native location API. */
  accuracy: number;
  /** UNIX milliseconds from the location fix, not the callback arrival time. */
  timestamp: number;
}
export type GpsModality = 'walking' | 'running' | 'cycling';
export type GpsReason = 'accepted' | 'anchor' | 'paused' | 'invalid' | 'inaccurate' | 'stale' | 'out_of_order' | 'gap' | 'jump' | 'jitter';
export interface GpsFilterOptions {
  maxAccuracyMeters?: number;
  maxAgeMs?: number;
  maxGapMs?: number;
  maxSpeedMetersPerSecond?: number;
  minimumMovementMeters?: number;
}
export interface GpsFilterResult {
  accepted: boolean;
  /** Increment for this fix, never the full route distance. */
  distanceMeters: number;
  totalDistanceMeters: number;
  breakSegment: boolean;
  reason: GpsReason;
  point?: GpsPoint;
}
export interface GpsFilterSnapshot {
  version: 1;
  modality: GpsModality;
  totalDistanceMeters: number;
  anchor: GpsPoint | null;
  lastTimestamp: number | null;
  paused: boolean;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
function validCoordinates(point: Coordinates): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}
function validPoint(point: GpsPoint): boolean {
  return validCoordinates(point) && Number.isFinite(point.accuracy) && point.accuracy >= 0 && Number.isFinite(point.timestamp) && point.timestamp > 0;
}

/** Great-circle distance in meters, including a correct antimeridian crossing. */
export function haversine(a: Coordinates, b: Coordinates): number {
  if (!validCoordinates(a) || !validCoordinates(b)) throw new RangeError('Coordenadas inválidas.');
  const radians = Math.PI / 180;
  const latitudeDelta = (b.latitude - a.latitude) * radians;
  const longitudeDelta = (b.longitude - a.longitude) * radians;
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

/**
 * Conservative distance accumulator. Pauses and missing fixes never become
 * straight lines. This rejects implausible data; it does not prove an activity
 * happened or guarantee fraud prevention.
 */
export class GpsFilter {
  private readonly config: Required<GpsFilterOptions>;
  private anchor: GpsPoint | null = null;
  private lastTimestamp: number | null = null;
  private total = 0;
  private paused = false;
  constructor(readonly modality: GpsModality, options: GpsFilterOptions = {}) {
    if (!['walking', 'running', 'cycling'].includes(modality)) throw new RangeError('Modalidade GPS inválida.');
    const maxSpeeds: Record<GpsModality, number> = { walking: 4, running: 12, cycling: 30 };
    this.config = {
      maxAccuracyMeters: options.maxAccuracyMeters ?? 35,
      maxAgeMs: options.maxAgeMs ?? 15_000,
      maxGapMs: options.maxGapMs ?? 30_000,
      maxSpeedMetersPerSecond: options.maxSpeedMetersPerSecond ?? maxSpeeds[modality],
      minimumMovementMeters: options.minimumMovementMeters ?? 3,
    };
    if (Object.values(this.config).some(value => !Number.isFinite(value) || value <= 0)) throw new RangeError('Configuração GPS inválida.');
  }
  pause(): void { this.paused = true; this.anchor = null; }
  resume(): void { this.paused = false; this.anchor = null; }
  reset(): void { this.anchor = null; this.lastTimestamp = null; this.total = 0; this.paused = false; }
  snapshot(): GpsFilterSnapshot {
    return { version: 1, modality: this.modality, totalDistanceMeters: this.total, anchor: this.anchor ? { ...this.anchor } : null, lastTimestamp: this.lastTimestamp, paused: this.paused };
  }
  restore(snapshot: GpsFilterSnapshot): void {
    if (snapshot.version !== 1 || snapshot.modality !== this.modality || !Number.isFinite(snapshot.totalDistanceMeters) || snapshot.totalDistanceMeters < 0 || typeof snapshot.paused !== 'boolean' ||
      (snapshot.lastTimestamp !== null && (!Number.isFinite(snapshot.lastTimestamp) || snapshot.lastTimestamp <= 0)) ||
      (snapshot.anchor !== null && (!validPoint(snapshot.anchor) || snapshot.anchor.accuracy > this.config.maxAccuracyMeters || snapshot.lastTimestamp === null || snapshot.anchor.timestamp > snapshot.lastTimestamp))) {
      throw new RangeError('Registro GPS local inválido.');
    }
    this.total = snapshot.totalDistanceMeters;
    this.lastTimestamp = snapshot.lastTimestamp;
    this.paused = snapshot.paused;
    this.anchor = snapshot.paused || !snapshot.anchor ? null : { ...snapshot.anchor };
  }
  push(point: GpsPoint, nowMs: number = Date.now()): GpsFilterResult {
    const result = (accepted: boolean, reason: GpsReason, distanceMeters = 0, breakSegment = false): GpsFilterResult => ({
      accepted, reason, distanceMeters, totalDistanceMeters: this.total, breakSegment, ...(accepted ? { point: { ...point } } : {}),
    });
    const reject = (reason: GpsReason): GpsFilterResult => { this.anchor = null; return result(false, reason, 0, true); };
    if (this.paused) return reject('paused');
    if (!validPoint(point) || !Number.isFinite(nowMs)) return reject('invalid');
    if (point.accuracy > this.config.maxAccuracyMeters) return reject('inaccurate');
    if (nowMs - point.timestamp > this.config.maxAgeMs || point.timestamp - nowMs > 5_000) return reject('stale');
    if (this.lastTimestamp !== null && point.timestamp <= this.lastTimestamp) return reject('out_of_order');
    const lastTimestamp = this.lastTimestamp;
    this.lastTimestamp = point.timestamp;
    if (!this.anchor) {
      this.anchor = { ...point };
      return result(true, 'anchor', 0, true);
    }
    if (lastTimestamp !== null && point.timestamp - lastTimestamp > this.config.maxGapMs) {
      this.anchor = { ...point };
      return result(true, 'gap', 0, true);
    }
    const distance = haversine(this.anchor, point);
    const elapsedSeconds = (point.timestamp - this.anchor.timestamp) / 1000;
    if (elapsedSeconds <= 0 || distance / elapsedSeconds > this.config.maxSpeedMetersPerSecond) return reject('jump');
    const movementThreshold = Math.max(this.config.minimumMovementMeters, Math.min(this.anchor.accuracy, point.accuracy) * 0.35);
    // Keep the movement anchor through jitter; successive small real movements
    // can eventually exceed the threshold without summing every noisy fix.
    if (distance < movementThreshold) return result(false, 'jitter');
    this.anchor = { ...point };
    this.total += distance;
    return result(true, 'accepted', distance);
  }
}
