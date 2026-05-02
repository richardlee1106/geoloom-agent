import type { FastifyInstance } from 'fastify'

import type { NarrativeBuilder, NarrativeRequest } from '../narrative/contract.js'

function isNarrativeContractError(error: unknown): error is Error & { code: string; statusCode: number } {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
}

export async function registerNarrativeRoutes(
  app: FastifyInstance,
  deps: {
    narrative?: NarrativeBuilder
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
}
