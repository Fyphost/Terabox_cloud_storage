import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getMediaById, presentMedia } from './media.service.js';
import { buildSyntheticMaster, type VariantInfo } from '../stream/hls.rewriter.js';
import { buildSignedPath, sign } from '../../services/signing/signed-url.js';
import { env } from '../../config/env.js';

const ParamId = z.object({ id: z.string().min(1) });

const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id', async (req) => {
    const { id } = ParamId.parse(req.params);
    const { media, variants } = await getMediaById(id);
    return presentMedia(media, variants, req.userId ?? null);
  });

  /**
   * Synthetic master playlist. hls.js loads this once and gets all qualities
   * as selectable levels. Each level URI is itself a signed playlist URL.
   */
  app.get('/:id/master.m3u8', async (req, reply) => {
    const { id } = ParamId.parse(req.params);
    const { variants } = await getMediaById(id);

    const userId = req.userId ?? null;
    const variantInfos: VariantInfo[] = variants.map((v) => ({
      variantId: v.id,
      upstreamUrl: v.upstreamPlaylistUrl ?? '',
      bandwidth: v.bitrateBps ?? undefined,
      resolution: v.width && v.height ? `${v.width}x${v.height}` : undefined,
    }));

    const master = buildSyntheticMaster(variantInfos, (variantId) => {
      const q = sign({ variantId, resource: 'playlist.m3u8', userId });
      return buildSignedPath(
        `${env.PUBLIC_BASE_URL}/api/v1/stream/${variantId}/playlist.m3u8`,
        q,
      );
    });

    reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'private, no-store');
    return master;
  });
};

export default mediaRoutes;
