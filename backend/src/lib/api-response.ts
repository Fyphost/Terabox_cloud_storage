/**
 * Centralized API response shape.
 *
 *   ok:    { ok: true,  data: T }
 *   error: { ok: false, error: { code, message, issues? } }
 *
 * Routes can return values directly (Fastify will JSON-serialize), but
 * controllers that want to wrap the payload should use `okResponse`. The
 * error path is owned by `error-handler.plugin.ts` so route code never
 * builds error envelopes by hand.
 */

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrEnvelope {
  ok: false;
  error: { code: string; message: string; issues?: unknown };
}

export type ApiEnvelope<T> = OkEnvelope<T> | ErrEnvelope;

export function okResponse<T>(data: T): OkEnvelope<T> {
  return { ok: true, data };
}
