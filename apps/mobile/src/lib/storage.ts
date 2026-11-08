import * as SQLite from 'expo-sqlite';
import type { LocalActivity, RoutePoint } from './types';
export interface StoredActivity extends LocalActivity {
  segment: number;
  filterSnapshot: unknown;
  runtimeId: string;
  lastTickAt: number;
  lastMonotonic: number;
  endedOffline: boolean;
  stepsEnabled: boolean;
  pendingDelete?: boolean;
  captureStartedAt?: number;
}
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
export async function database() {
  if (!opening) opening = (async () => {
    const db = await SQLite.openDatabaseAsync('consta-private-v1.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS local_activities (
        client_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS local_activity_owner ON local_activities(owner_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS route_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL REFERENCES local_activities(client_id) ON DELETE CASCADE,
        segment INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL NOT NULL,
        UNIQUE(client_id,timestamp)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        client_id TEXT PRIMARY KEY REFERENCES local_activities(client_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    return db;
  })();
  return opening;
}
export async function putActivity(activity: StoredActivity) {
  const db = await database();
  await db.runAsync('INSERT INTO local_activities(client_id,owner_id,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', activity.clientId, activity.ownerId, JSON.stringify(activity), Date.now());
}
export async function readActivity(id: string, ownerId?: string): Promise<StoredActivity | null> {
  const db = await database();
  const row = ownerId
    ? await db.getFirstAsync<{data:string}>('SELECT data FROM local_activities WHERE client_id=? AND owner_id=?', id, ownerId)
    : await db.getFirstAsync<{data:string}>('SELECT data FROM local_activities WHERE client_id=?', id);
  return row ? JSON.parse(row.data) as StoredActivity : null;
}
export async function readActivities(ownerId: string): Promise<StoredActivity[]> {
  const db = await database();
  const rows = await db.getAllAsync<{data:string}>('SELECT data FROM local_activities WHERE owner_id=? ORDER BY updated_at DESC', ownerId);
  return rows.map(row => JSON.parse(row.data) as StoredActivity);
}
export async function appendPoint(id: string, p: RoutePoint) {
  const db = await database();
  await db.runAsync('INSERT OR IGNORE INTO route_points(client_id,segment,timestamp,latitude,longitude,accuracy) VALUES(?,?,?,?,?,?)', id, p.segment, p.timestamp, p.latitude, p.longitude, p.accuracy);
}
export async function readRoute(id: string, ownerId: string): Promise<RoutePoint[]> {
  const db = await database();
  return db.getAllAsync<RoutePoint>('SELECT latitude,longitude,accuracy,timestamp,segment FROM route_points WHERE client_id=? AND EXISTS(SELECT 1 FROM local_activities a WHERE a.client_id=? AND a.owner_id=?) ORDER BY timestamp,id', id,id,ownerId);
}
export async function setActiveId(id: string | null) {
  const db = await database();
  if (id) await db.runAsync("INSERT INTO local_meta(key,value) VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", id);
  else await db.runAsync("DELETE FROM local_meta WHERE key='active'");
}
export async function getActiveId(): Promise<string | null> {
  const row = await (await database()).getFirstAsync<{value:string}>("SELECT value FROM local_meta WHERE key='active'");
  return row?.value ?? null;
}
export async function enqueue(activity: StoredActivity) {
  const db = await database();
  await db.withTransactionAsync(async () => {
    await putActivity(activity);
    await db.runAsync('INSERT OR IGNORE INTO outbox(client_id,owner_id) VALUES(?,?)',activity.clientId,activity.ownerId);
  });
}
export async function queued(ownerId: string): Promise<string[]> {
  const rows = await (await database()).getAllAsync<{client_id:string}>('SELECT client_id FROM outbox WHERE owner_id=? ORDER BY rowid', ownerId);
  return rows.map(r => r.client_id);
}
export async function acknowledge(activity: StoredActivity,assertCurrent:()=>void=()=>{}) {
  const db = await database();
  await db.withTransactionAsync(async () => {
    assertCurrent();
    await putActivity(activity);assertCurrent();
    await db.runAsync('DELETE FROM outbox WHERE client_id=? AND owner_id=?', activity.clientId,activity.ownerId);assertCurrent();
  });
}
export async function markAttempt(id: string, code: string) {
  await (await database()).runAsync('UPDATE outbox SET attempts=attempts+1,last_error=? WHERE client_id=?', code,id);
}
export async function removeActivity(id: string, ownerId: string) {
  await (await database()).runAsync('DELETE FROM local_activities WHERE client_id=? AND owner_id=?',id,ownerId);
}
export async function deleteOwnerData(ownerId: string) {
  const db = await database();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM local_activities WHERE owner_id=?', ownerId);
    await db.runAsync("DELETE FROM local_meta WHERE key LIKE ?", 'reminders.'+ownerId+'%');
  });
}
export async function setLocalPreference(key: string, value: unknown) {
  await (await database()).runAsync('INSERT INTO local_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));
}
export async function getLocalPreference<T>(key: string): Promise<T | null> {
  const row=await (await database()).getFirstAsync<{value:string}>('SELECT value FROM local_meta WHERE key=?',key);
  return row ? JSON.parse(row.value) as T : null;
}

export async function deleteRoute(id:string){
  await (await database()).runAsync('DELETE FROM route_points WHERE client_id=?',id);
}
