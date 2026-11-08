import { ZodError } from 'zod';
import type { FastifyInstance } from 'fastify';
export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function requireValue<T>(value: T | null | undefined, code = 'NOT_FOUND'): T {
  if (value == null) throw new ApiError(404, code, 'Registro não encontrado.');
  return value;
}
export function installErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({error: {code: 'VALIDATION', message: 'Confira os campos informados.', fields: error.issues.map(i => ({path: i.path.join('.'), message: i.message}))}});
    if (error instanceof ApiError) return reply.code(error.statusCode).send({error: {code: error.code, message: error.message}});
    const pgCode = (error as {code?: string}).code;
    if (pgCode === '23505') return reply.code(409).send({error: {code: 'CONFLICT', message: 'Este registro já existe.'}});
    if (pgCode === '23503') return reply.code(409).send({error: {code: 'RELATED_RECORD', message: 'Um registro relacionado não está disponível.'}});
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({error: {code: 'REQUEST_REJECTED', message: error.message}});
    // Never include tokens, request bodies, database details or health data in logs/responses.
    return reply.code(500).send({error: {code: 'INTERNAL', message: 'Não foi possível concluir. Tente novamente.'}});
  });
}
