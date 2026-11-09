import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
declare module 'fastify' {
  interface FastifyRequest { user: {id: string; displayName: string}; sessionFamilyId: string }
}
export type Authenticator = (request: FastifyRequest) => Promise<void>;
export const uuid = z.string().uuid();
export const modalitySchema = z.enum(['strength','walking','running','cycling','football','basketball','volleyball']);
export const sourceSchema = z.enum(['self_reported','gps','manual','health_connect','healthkit']);
export const environmentSchema = z.enum(['home','gym','outdoor']);
export const idParams = z.object({id: uuid});
export function iso(value: Date | string | null): string | null { return value == null ? null : new Date(value).toISOString(); }
