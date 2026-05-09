import type { FastifyInstance } from 'fastify'

import type { NarrativeBuilder, NarrativeRequest } from '../narrative/contract.js'
import type { NarrativeTtsProvider, NarrativeTtsRequest } from '../narrative/NarrativeTtsService.js'

function isNarrativeContractError(error: unknown): error is Error & { code: string; statusCode: number } {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
}

export async function registerNarrativeRoutes(
  app: FastifyInstance,
  deps: {
    narrative?: NarrativeBuilder
    tts?: NarrativeTtsProvider
  },
) {
  app.post('/', async (request, reply) => {
    if (!deps.narrative) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_unavailable',
          message: 'Narrative runtime is unavailable',
        },
      })
    }

    try {
      const response = await deps.narrative.build((request.body || {}) as NarrativeRequest)
      return reply.send(response)
    } catch (error) {
      if (isNarrativeContractError(error)) {
        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        })
      }
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: {
          code: 'narrative_failed',
          message: error instanceof Error ? error.message : 'Narrative request failed',
        },
      })
    }
  })

  app.get('/tts/health', async () => {
    return deps.tts?.health() ?? { enabled: false, ready: false }
  })

  app.post('/tts', async (request, reply) => {
    if (!deps.tts) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_tts_unavailable',
          message: 'Narrative TTS is unavailable',
        },
      })
    }

    try {
      const result = await deps.tts.synthesize((request.body || {}) as NarrativeTtsRequest)
      reply.header('cache-control', 'public, max-age=31536000, immutable')
      reply.header('x-narrative-tts-cache-key', result.cacheKey)
      reply.header('x-narrative-tts-cached', result.cached ? '1' : '0')
      return reply.type(result.contentType).send(result.audio)
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: {
          code: 'narrative_tts_failed',
          message: error instanceof Error ? error.message : 'Narrative TTS request failed',
        },
      })
    }
  })

  app.get('/enrichment/:jobId', async (request, reply) => {
    if (!deps.narrative?.getEnrichmentJob) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_enrichment_unavailable',
          message: 'Narrative enrichment is unavailable',
        },
      })
    }
    const jobId = String((request.params as { jobId?: string }).jobId || '').trim()
    const job = deps.narrative.getEnrichmentJob(jobId)
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'narrative_enrichment_not_found',
          message: 'Narrative enrichment job was not found',
        },
      })
    }
    return reply.send(job)
  })
}
