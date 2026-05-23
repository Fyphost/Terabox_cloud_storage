/**
 * Single fetch wrapper.
 * - Always sends credentials (cookie-based JWT).
 * - Throws typed ApiError on non-2xx.
 * - Accepts AbortSignal for in-flight cancellation on route changes.
 *
 * Uses same-origin paths in browser; rewrites are configured in next.config.ts.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  signal?: AbortSignal;
}

const BASE = '/api/v1';

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
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
    throw new ApiError(res.status, code, message);
  }

  return json as T;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
