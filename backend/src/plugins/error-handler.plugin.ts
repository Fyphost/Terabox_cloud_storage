import fp from 'fastify-plugin';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export default fp(async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, msg: err.userMessage }, 'app error');
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.userMessage },
      });
    }

    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, 'validation error');
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid request', issues: err.issues },
      });
    }

    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: { code: err.code ?? 'BAD_REQUEST', message: err.message },
      });
    }

    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });
});
