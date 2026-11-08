import type { ApiErrorBody, ErrorCode, SessionDto } from '@stockflow/shared';

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface SessionListeners {
  onRefreshed?: (session: SessionDto) => void;
  onEnded?: () => void;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<SessionDto | null> | null = null;
let listeners: SessionListeners = {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSessionListeners(next: SessionListeners) {
  listeners = next;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  if (body?.error) {
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', 'Something went wrong. Try again.');
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<SessionDto | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const session = ((await res.json()) as { data: SessionDto }).data;
      accessToken = session.accessToken;
      return session;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

/** Sends a request with the access token, refreshing it once on 401. */
async function authorizedFetch(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, signal } = options;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const url = params.size > 0 ? `${path}?${params.toString()}` : path;

  const attempt = () => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return send(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  };

  let res = await attempt();

  // Auth endpoints report their own 401s (e.g. wrong password); everything else gets one refresh-and-retry.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (!session) {
      listeners.onEnded?.();
      throw await toApiError(res);
    }
    listeners.onRefreshed?.(session);
    res = await attempt();
    if (res.status === 401) {
      listeners.onEnded?.();
      throw await toApiError(res);
    }
  }

  if (!res.ok) throw await toApiError(res);
  return res;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await authorizedFetch(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Downloads a file endpoint (e.g. a CSV export) and saves it under the server's filename. */
export async function apiDownload(path: string, query: RequestOptions['query']): Promise<void> {
  const res = await authorizedFetch(path, { query });
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
