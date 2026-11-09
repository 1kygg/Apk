import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { Pool, PoolClient } from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import { hasSigningKey } from '../config.js';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
export interface Identity { sub: string; displayName?: string; avatarUrl?: string }
export type IdentityVerifier = (provider: 'google' | 'apple', token: string, nonceHash?: string) => Promise<Identity>;
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
export function createIdentityVerifier(config: ApiConfig): IdentityVerifier {
  const google = new OAuth2Client();
  const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  return async (provider, token, nonceHash) => {
    if (provider === 'google') {
      if (!config.googleClientIds.length) throw new ApiError(503, 'GOOGLE_UNCONFIGURED', 'Configure os identificadores OAuth do Google.');
      try {
        const ticket = await google.verifyIdToken({idToken: token, audience: config.googleClientIds});
        const payload = ticket.getPayload();
        if (!payload?.sub || !['accounts.google.com','https://accounts.google.com'].includes(payload.iss)) throw new Error('issuer');
        return {sub: payload.sub, displayName: payload.name, avatarUrl: payload.picture};
      } catch { throw new ApiError(401, 'INVALID_IDENTITY', 'A credencial do Google é inválida ou expirou.'); }
    }
    if (!config.appleClientIds.length) throw new ApiError(503, 'APPLE_UNCONFIGURED', 'Configure os identificadores de login da Apple.');
    try {
      const {payload} = await jwtVerify(token, appleKeys, {issuer: 'https://appleid.apple.com', audience: config.appleClientIds, algorithms: ['RS256']});
      if (!payload.sub || !nonceHash || payload.nonce !== nonceHash) throw new Error('nonce');
      return {sub: payload.sub};
    } catch { throw new ApiError(401, 'INVALID_IDENTITY', 'A credencial da Apple é inválida ou expirou.'); }
  };
}
function publicUser(row: Record<string, any>, onboarded = false) {
  return {id: row.id as string, displayName: row.display_name as string, avatarUrl: row.avatar_url as string | null, onboardingComplete: onboarded};
}
export function createAuthService(pool: Pool, config: ApiConfig, injectedVerifier?: IdentityVerifier) {
  const verify = injectedVerifier ?? createIdentityVerifier(config);
  const assertReady = () => { if (!hasSigningKey(config)) throw new ApiError(503, 'AUTH_UNCONFIGURED', 'Configure uma chave de assinatura com pelo menos 32 bytes.'); };
  async function accessToken(userId: string, familyId: string): Promise<string> {
    assertReady();
    return new SignJWT({fid: familyId}).setProtectedHeader({alg: 'HS256', typ: 'JWT'}).setSubject(userId).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(config.jwtSecret));
  }
  async function issue(client: PoolClient, row: Record<string, any>, familyId = randomUUID()) {
    const refreshToken = opaque();
    const session = await client.query('INSERT INTO refresh_sessions(user_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval \'30 days\') RETURNING id', [row.id, familyId, hashToken(refreshToken)]);
    const preferences = await client.query('SELECT 1 FROM user_preferences WHERE user_id=$1', [row.id]);
    return {accessToken: await accessToken(row.id, familyId), refreshToken, expiresIn: 900, user: publicUser(row, !!preferences.rowCount), sessionId: session.rows[0].id as string};
  }
  return {
    async createNonce() {
      assertReady();
      if(!config.appleClientIds.length&&!injectedVerifier)throw new ApiError(503,'APPLE_UNCONFIGURED','Configure os identificadores de login da Apple.');
      const nonce = opaque();
      const nonceHash = hashToken(nonce);
      const result = await pool.query('INSERT INTO apple_nonces(nonce_hash) VALUES($1) RETURNING id', [nonceHash]);
      await pool.query('DELETE FROM apple_nonces WHERE expires_at < clock_timestamp()-interval \'1 day\'');
      return {nonce, nonceHash, nonceId: result.rows[0].id as string};
    },
    async login(provider: 'google' | 'apple', token: string, options?: {nonceId?: string; displayName?: string}) {
      assertReady();
      let nonceHash: string | undefined;
      if (provider === 'apple') {
        const nonce = await pool.query('SELECT nonce_hash FROM apple_nonces WHERE id=$1 AND used_at IS NULL AND expires_at>clock_timestamp()', [options?.nonceId]);
        if (!nonce.rowCount) throw new ApiError(401, 'INVALID_NONCE', 'Inicie o login com Apple novamente.');
        nonceHash = nonce.rows[0].nonce_hash;
      }
      const identity = await verify(provider, token, nonceHash);
      if (!identity.sub || identity.sub.length > 255) throw new ApiError(401, 'INVALID_IDENTITY', 'Identidade inválida.');
      return withTransaction(pool, async client => {
        if (provider === 'apple') {
          const consumed = await client.query('UPDATE apple_nonces SET used_at=clock_timestamp() WHERE id=$1 AND used_at IS NULL AND expires_at>clock_timestamp() RETURNING id', [options?.nonceId]);
          if (!consumed.rowCount) throw new ApiError(401, 'INVALID_NONCE', 'Esta tentativa de login já foi utilizada.');
        }
        const field = provider === 'google' ? 'google_sub' : 'apple_sub';
        const displayName = (options?.displayName ?? identity.displayName ?? 'Atleta').trim().slice(0, 80) || 'Atleta';
        const avatar = identity.avatarUrl?.startsWith('https://') && identity.avatarUrl.length < 2000 ? identity.avatarUrl : null;
        const result = await client.query('INSERT INTO users(' + field + ',display_name,avatar_url) VALUES($1,$2,$3) ON CONFLICT (' + field + ') DO UPDATE SET ' + field + '=EXCLUDED.' + field + ' RETURNING *', [identity.sub, displayName, avatar]);
        const issued = await issue(client, result.rows[0]);
        const {sessionId: _sessionId, ...body} = issued;
        return body;
      });
    },
    async refresh(refreshToken: string) {
      assertReady();
      const result = await withTransaction(pool, async client => {
        const found = await client.query('SELECT * FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE', [hashToken(refreshToken)]);
        const session = found.rows[0];
        if (!session) return {error: 'INVALID_REFRESH'} as const;
        if (session.used_at || session.revoked_at) {
          await client.query('UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE family_id=$1', [session.family_id]);
          return {error: 'REFRESH_REUSED'} as const;
        }
        const alive = await client.query('SELECT 1 WHERE $1::timestamptz>clock_timestamp()', [session.expires_at]);
        if (!alive.rowCount) return {error: 'REFRESH_EXPIRED'} as const;
        const user = await client.query('SELECT * FROM users WHERE id=$1', [session.user_id]);
        if (!user.rowCount) return {error: 'INVALID_REFRESH'} as const;
        const issued = await issue(client, user.rows[0], session.family_id);
        await client.query('UPDATE refresh_sessions SET used_at=clock_timestamp(), replaced_by=$2 WHERE id=$1', [session.id, issued.sessionId]);
        const {sessionId: _sessionId, ...body} = issued;
        return {body} as const;
      });
      if ('error' in result) throw new ApiError(401, result.error ?? 'INVALID_REFRESH', 'Sua sessão expirou. Entre novamente.');
      return result.body;
    },
    async logout(userId: string, familyId: string, refreshToken?: string) {
      await pool.query('UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=$1 AND (family_id=$2 OR token_hash=$3)', [userId, familyId, refreshToken ? hashToken(refreshToken) : '']);
    },
    async authenticate(request: FastifyRequest): Promise<void> {
      assertReady();
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar.');
      let userId: string; let familyId: string;
      try {
        const {payload} = await jwtVerify(header.slice(7), new TextEncoder().encode(config.jwtSecret), {issuer: config.issuer, audience: config.audience, algorithms: ['HS256']});
        if (!payload.sub || typeof payload.fid !== 'string') throw new Error('claims');
        userId = payload.sub; familyId = payload.fid;
      } catch { throw new ApiError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.'); }
      const user = await pool.query('SELECT id,display_name FROM users WHERE id=$1 AND EXISTS(SELECT 1 FROM refresh_sessions WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp())', [userId, familyId]);
      if (!user.rowCount) throw new ApiError(401, 'SESSION_REVOKED', 'Sua sessão foi encerrada.');
      request.user = {id: userId, displayName: user.rows[0].display_name};
      request.sessionFamilyId = familyId;
    },
  };
}
