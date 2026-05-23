import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getMediaById, presentMedia } from './media.service.js';
import { buildSyntheticMaster, type VariantInfo } from '../stream/hls.rewriter.js';
import { buildRelativeStreamUrl } from '../../services/signing/signed-url.js';

const ParamId = z.object({ id: z.string().min(1) });

const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id', async (req) => {
    const { id } = ParamId.parse(req.params);
    const { media, variants } = await getMediaById(id);
    return presentMedia(media, variants, req.userId ?? null);
  });

  /**
   * Synthetic master playlist. hls.js loads this once and gets every quality
   * as a selectable level. Each level URI is itself a signed playlist URL.
   *
   * URLs in the body are RELATIVE to support both same-origin (Next rewrite)
   * and cross-origin (CDN edge) deployment without CORS issues for the player.
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

    const master = buildSyntheticMaster(variantInfos, (variantId) =>
      buildRelativeStreamUrl(variantId, 'playlist.m3u8', userId),
    );

    reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'private, no-store')
      // Permissive CORS for the player; signed URLs are the actual auth.
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range, Content-Type')
      .header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    return master;
  });
};

export default mediaRoutes;
