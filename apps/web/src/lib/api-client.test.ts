import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  refreshSession,
  setAccessToken,
  setSessionListeners,
} from './api-client';

const session = {
  accessToken: 'new-token',
  user: { id: 'u1', role: 'staff' },
  permissions: [],
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('old-token');
  setSessionListeners({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const authHeader = (call: number) =>
  (fetchMock.mock.calls[call]![1]!.headers as Record<string, string>).Authorization;

describe('apiRequest', () => {
  it('sends the bearer token, JSON body and query string', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: 1 }));
    await apiRequest('/users', { method: 'POST', body: { a: 1 }, query: { page: 2, search: '' } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/users?page=2');
    expect(init!.body).toBe('{"a":1}');
    expect(authHeader(0)).toBe('Bearer old-token');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const onRefreshed = vi.fn();
    setSessionListeners({ onRefreshed });
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { data: session }))
      .mockResolvedValueOnce(json(200, { data: 'ok' }));

    await expect(apiRequest('/users')).resolves.toEqual({ data: 'ok' });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
    expect(authHeader(2)).toBe('Bearer new-token');
    expect(onRefreshed).toHaveBeenCalledWith(session);
  });

  it('ends the session when the refresh fails', async () => {
    const onEnded = vi.fn();
    setSessionListeners({ onEnded });
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }));

    await expect(apiRequest('/users')).rejects.toMatchObject({ status: 401 });
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('does not refresh on auth endpoint errors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' } }),
    );
    const error: unknown = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shares one refresh request between concurrent callers', async () => {
    let resolve!: (res: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const a = refreshSession();
    const b = refreshSession();
    resolve(json(200, { data: session }));
    expect(await a).toEqual(session);
    expect(await b).toEqual(session);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps validation details and network failures', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are invalid',
          details: [{ path: 'email', message: 'Enter a valid email address' }],
        },
      }),
    );
    await expect(apiRequest('/users', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'email', message: 'Enter a valid email address' }],
    });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiRequest('/users')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
