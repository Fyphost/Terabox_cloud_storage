import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/**
 * Single source of truth for error responses.
 * Wraps everything into:  { ok: false, error: { code, message, issues? } }
 */
export default fp(async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, msg: err.userMessage }, 'app error');
      return reply
        .status(err.httpStatus)
        .send({ ok: false, error: { code: err.code, message: err.userMessage } });
    }

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'validation error');
      return reply.status(400).send({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request', issues: err.issues },
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique constraint, P2025 not found, etc.
      const map: Record<string, { http: number; code: string; message: string }> = {
        P2002: { http: 409, code: 'CONFLICT', message: 'Duplicate value violates a unique constraint' },
        P2025: { http: 404, code: 'NOT_FOUND', message: 'Record not found' },
      };
      const m = map[err.code];
      if (m) {
        req.log.warn({ prismaCode: err.code }, 'prisma error');
        return reply.status(m.http).send({ ok: false, error: { code: m.code, message: m.message } });
      }
    }

    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      const e = err as FastifyError;
      return reply
        .status(e.statusCode!)
        .send({ ok: false, error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    }

    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send({ ok: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
  });
});
