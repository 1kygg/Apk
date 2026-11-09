import type { Database } from '../db.js';
import { ApiError } from '../errors.js';
export async function requireMembership(db: Database, groupId: string, userId: string, admin = false) {
  const result = await db.query('SELECT g.*,m.role FROM groups g JOIN group_members m ON m.group_id=g.id WHERE g.id=$1 AND m.user_id=$2', [groupId,userId]);
  const group = result.rows[0];
  if (!group) throw new ApiError(404, 'GROUP_NOT_FOUND', 'Grupo não encontrado.');
  if (admin && group.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem realizar esta ação.');
  return group;
}
export async function requireChallenge(db: Database, challengeId: string, userId: string, admin = false) {
  const result = await db.query('SELECT c.*,m.role FROM challenges c JOIN group_members m ON m.group_id=c.group_id WHERE c.id=$1 AND m.user_id=$2', [challengeId,userId]);
  const challenge = result.rows[0];
  if (!challenge) throw new ApiError(404, 'CHALLENGE_NOT_FOUND', 'Desafio não encontrado.');
  if (admin && challenge.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem realizar esta ação.');
  return challenge;
}
export async function notifyGroup(db: Database, groupId: string, challengeId: string | null, title: string, message: string): Promise<void> {
  await db.query('INSERT INTO notifications(user_id,group_id,challenge_id,title,message) SELECT user_id,$1,$2,$3,$4 FROM group_members WHERE group_id=$1', [groupId,challengeId,title,message]);
}
export async function audit(db: Database, data: {groupId?: string;challengeId?: string;actorId:string;action:string;reason?:string;details?:unknown}): Promise<void> {
  await db.query('INSERT INTO audit_events(group_id,challenge_id,actor_id,action,reason,details) VALUES($1,$2,$3,$4,$5,$6)', [data.groupId ?? null,data.challengeId ?? null,data.actorId,data.action,data.reason ?? null,JSON.stringify(data.details ?? {})]);
}
