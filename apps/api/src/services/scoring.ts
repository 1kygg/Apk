import { validateRules, calculateMaximum, scoreActivities, classifyRanking } from '@consta/domain';
import type { ActivityRecord, ChallengeRules } from '@consta/domain';
import type { PoolClient } from 'pg';
import { lockKey } from '../db.js';
import { ApiError } from '../errors.js';
import { iso } from '../types.js';
export function parseRules(input: unknown): ChallengeRules {
  try { return validateRules(input); } catch (error) {
    throw new ApiError(400, 'INVALID_RULES', error instanceof Error ? error.message.slice(0, 800) : 'Regulamento inválido.');
  }
}
export async function scoreForRules(client: PoolClient, challenge: {id:string;group_id:string;rules:unknown}, override?: ChallengeRules) {
  const rules = override ?? parseRules(challenge.rules);
  const members = await client.query('SELECT u.id AS "userId",u.display_name AS "displayName",u.avatar_url AS "avatarUrl" FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1', [challenge.group_id]);
  const activities = await client.query(`SELECT a.*,r.decision,r.corrected_start_at,r.corrected_end_at,r.corrected_distance_meters,r.corrected_active_seconds FROM activities a JOIN group_members m ON m.user_id=a.user_id AND m.group_id=$1 LEFT JOIN activity_reviews r ON r.activity_id=a.id AND r.challenge_id=$2 WHERE a.status='completed'`, [challenge.group_id,challenge.id]);
  const records: ActivityRecord[] = activities.rows.map(row => {
    const reviewed = row.decision === 'approve';
    const eligibility = row.decision === 'reject' ? 'ineligible' : reviewed ? 'verified' : row.eligibility;
    return {
      id: row.id, userId: row.user_id, modality: row.modality, source: row.source, eligibility,
      verifiedStartAt: eligibility === 'verified' ? iso(reviewed ? row.corrected_start_at ?? row.recorded_start_at ?? row.started_at : row.started_at) : null,
      verifiedEndAt: eligibility === 'verified' ? iso(reviewed ? row.corrected_end_at ?? row.recorded_end_at ?? row.ended_at : row.ended_at) : null,
      receivedAt: iso(row.received_at)!, activeSeconds: row.corrected_active_seconds ?? row.active_seconds,
      distanceMeters: row.corrected_distance_meters ?? row.distance_meters ?? undefined,
      steps: row.steps ?? undefined, completed: true,
    };
  });
  const clock = await client.query('SELECT clock_timestamp() AS now');
  const result = scoreActivities(rules, records, {asOf: iso(clock.rows[0].now)!});
  const participants = members.rows.map(row => ({userId: row.userId,displayName: row.displayName,avatarUrl: row.avatarUrl ?? undefined}));
  return {rules,result,ranking: classifyRanking(rules,result,participants),maximum: calculateMaximum(rules)};
}
export async function recomputeChallenge(client: PoolClient, challengeId: string) {
  await lockKey(client, 'challenge:' + challengeId);
  const found = await client.query('SELECT * FROM challenges WHERE id=$1 FOR UPDATE', [challengeId]);
  const challenge = found.rows[0];
  if (!challenge) return null;
  const scored = await scoreForRules(client, challenge);
  await client.query('DELETE FROM challenge_scores WHERE challenge_id=$1', [challengeId]);
  await client.query('DELETE FROM consistency_credits WHERE challenge_id=$1', [challengeId]);
  for (const user of scored.result.users) {
    await client.query('INSERT INTO challenge_scores(challenge_id,user_id,total,weeks_met,credits,weeks) VALUES($1,$2,$3,$4,$5,$6)', [challengeId,user.userId,user.total,user.weeksMet,JSON.stringify(user.credits),JSON.stringify(user.weeks)]);
    if (scored.rules.type === 'consistency') {
      for (const credit of user.credits) await client.query('INSERT INTO consistency_credits(challenge_id,user_id,activity_id,local_date,value) VALUES($1,$2,$3,$4,$5)', [challengeId,user.userId,credit.activityId,credit.date,credit.value]);
    }
  }
  const updated = await client.query('UPDATE challenges SET ranking_updated_at=clock_timestamp() WHERE id=$1 RETURNING ranking_updated_at', [challengeId]);
  return {...scored, updatedAt: iso(updated.rows[0].ranking_updated_at)!, revision: challenge.revision as number};
}
export async function recomputeUserGroups(client: PoolClient, userId: string): Promise<void> {
  const challenges = await client.query('SELECT c.id FROM challenges c JOIN group_members m ON m.group_id=c.group_id WHERE m.user_id=$1 ORDER BY c.id', [userId]);
  // Stable lock order prevents concurrent completions in several groups from deadlocking.
  for (const row of challenges.rows) await recomputeChallenge(client, row.id);
}
