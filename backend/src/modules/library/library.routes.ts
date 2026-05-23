import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deleteLibraryEntry, listLibrary } from './library.service.js';

const Query = z.object({
  search: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(50).optional(),
});

const Params = z.object({ savedMediaId: z.string().min(1) });

const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const userId = req.requireUser();
    const q = Query.parse(req.query);
    return listLibrary(userId, q);
  });

  app.delete('/:savedMediaId', async (req, reply) => {
    const userId = req.requireUser();
    const { savedMediaId } = Params.parse(req.params);
    await deleteLibraryEntry(savedMediaId, userId);
    return reply.status(204).send();
  });
};

export default libraryRoutes;
