import { getAccessToken, getSession, refreshSession } from './auth';
import { ApiError, request, type RequestOptions } from './transport';
export { ApiError } from './transport';
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let token = await getAccessToken();
  if (!token) throw new ApiError('Entre na sua conta para continuar.', 'AUTH_REQUIRED', 401);
  try { return await request<T>(path, options, token); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const latest=getSession()?.accessToken;
    token = latest && latest!==token ? latest : (await refreshSession())?.accessToken;
    if (!token) throw new ApiError('Sua sessão expirou. Entre novamente.', 'SESSION_EXPIRED', 401);
    return request<T>(path, options, token);
  }
}
