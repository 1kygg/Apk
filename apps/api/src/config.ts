export interface ApiConfig {
  jwtSecret: string;
  googleClientIds: string[];
  appleClientIds: string[];
  issuer: string;
  audience: string;
}
const list = (value: string | undefined) => (value ?? '').split(',').map(x => x.trim()).filter(Boolean);
export function readConfig(): ApiConfig {
  return {
    jwtSecret: process.env.JWT_SECRET ?? '',
    googleClientIds: list(process.env.GOOGLE_CLIENT_IDS),
    appleClientIds: list(process.env.APPLE_CLIENT_IDS),
    issuer: 'consta-api',
    audience: 'consta-native',
  };
}
export function hasSigningKey(config: ApiConfig): boolean {
  return Buffer.byteLength(config.jwtSecret, 'utf8') >= 32;
}
