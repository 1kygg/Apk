import { configuration } from './config';
export class ApiError extends Error {
  constructor(message: string, public code: string, public status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface RequestOptions { method?: string; body?: unknown }
export async function request<T>(path: string, options: RequestOptions = {}, accessToken?: string): Promise<T> {
  if (!configuration.apiConfigured) throw new ApiError('Configure o endereço HTTPS do servidor para conectar sua conta.', 'CONFIGURATION_REQUIRED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(configuration.apiUrl + (path.startsWith('/v1/') ? path : '/v1/' + path.replace(/^\//, '')), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Seus registros locais permanecem no aparelho.', 'NETWORK_ERROR');
  } finally { clearTimeout(timeout); }
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = body as { code?: string; message?: string; error?: {code?: string; message?: string} } | null;
    throw new ApiError(error?.message ?? error?.error?.message ?? 'O servidor não conseguiu concluir a operação.', error?.code ?? error?.error?.code ?? 'REQUEST_FAILED', response.status);
  }
  return body as T;
}
