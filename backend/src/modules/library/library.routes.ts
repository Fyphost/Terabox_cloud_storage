import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { deleteLibraryEntries, listLibrary } from './library.service.js';

const Query = z.object({
  search: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(50).optional(),
  sort: z.enum(['recent', 'oldest', 'name', 'size']).optional(),
});

const Params = z.object({ savedMediaId: z.string().min(1) });

const BulkDeleteBody = z.object({
  savedMediaIds: z.array(z.string().min(1)).min(1).max(100),
});

const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const userId = req.requireRegistered();
    const q = Query.parse(req.query);
    return listLibrary(userId, q);
  });

  app.delete('/:savedMediaId', async (req, reply) => {
    const userId = req.requireRegistered();
    const { savedMediaId } = Params.parse(req.params);
    await deleteLibraryEntries([savedMediaId], userId);
    return reply.status(204).send();
  });

  app.post('/bulk-delete', async (req, reply) => {
    const userId = req.requireRegistered();
    const body = BulkDeleteBody.parse(req.body);
    const removed = await deleteLibraryEntries(body.savedMediaIds, userId);
    return reply.status(200).send({ removed });
  });
};

export default libraryRoutes;
