import type { FastifyInstance } from 'fastify'

import type { SpatialFetchRequest, SpatialFeature } from '../spatial/fetchSpatialFeatures.js'

export async function registerSpatialRoutes(
  app: FastifyInstance,
  deps: {
    fetchSpatialFeatures?: (input: SpatialFetchRequest) => Promise<SpatialFeature[]>
  },
) {
  app.post('/fetch', async (request, reply) => {
    if (!deps.fetchSpatialFeatures) {
      return reply.status(503).send({
        success: false,
        error: 'spatial_fetch_unavailable',
      })
    }

    try {
      const features = await deps.fetchSpatialFeatures((request.body || {}) as SpatialFetchRequest)
      return {
        success: true,
        features,
      }
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'spatial_fetch_failed',
      })
    }
  })
}
