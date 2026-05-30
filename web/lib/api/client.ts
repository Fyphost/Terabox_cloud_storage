/**
 * Single fetch wrapper.
 * - Always sends credentials (httpOnly cookie auth).
 * - Throws typed ApiError on non-2xx with normalized payload.
 * - Auto-retries once after silent /auth/refresh on a 401.
 * - Accepts AbortSignal for in-flight cancellation on route changes.
 *
 * Uses same-origin paths in browser; Next rewrites forward to API in dev.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown;
  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  signal?: AbortSignal;
  /** Set to true to skip the silent refresh-on-401 retry (used by /auth/* routes themselves). */
  skipRefresh?: boolean;
}

const BASE = '/api/v1';
let inflightRefresh: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

async function rawFetch<T>(path: string, opts: ApiFetchOptions): Promise<T> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers,
    body,
    signal: opts.signal,
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const code = (json as { error?: { code?: string } } | undefined)?.error?.code ?? 'HTTP_ERROR';
    const message =
      (json as { error?: { message?: string } } | undefined)?.error?.message ?? res.statusText;
    const issues = (json as { error?: { issues?: unknown } } | undefined)?.error?.issues;
    throw new ApiError(res.status, code, message, issues);
  }

  // Backend returns either bare data or { ok: true, data }; we accept both.
  if (json && typeof json === 'object' && 'ok' in json && (json as { ok?: unknown }).ok === true) {
    const enveloped = json as { ok: true; data?: T };
    return (enveloped.data ?? (json as unknown as T)) as T;
  }
  return json as T;
}

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, opts);
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 401 &&
      !opts.skipRefresh &&
      !path.startsWith('/auth/')
    ) {
      const ok = await refreshSession();
      if (ok) return rawFetch<T>(path, { ...opts, skipRefresh: true });
    }
    throw err;
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
