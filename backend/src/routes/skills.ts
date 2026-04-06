import { randomUUID } from 'node:crypto'

import type { FastifyInstance } from 'fastify'

import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import { createLogger } from '../utils/logger.js'

export async function registerSkillRoutes(
  app: FastifyInstance,
  deps: {
    registry: SkillRegistry
  },
) {
  app.get('/skills', async () => ({
    skills: deps.registry.list(),
  }))

  app.post('/skills/:name/call', async (request, reply) => {
    const params = request.params as { name: string }
    const body = (request.body || {}) as {
      action?: string
      payload?: Record<string, unknown>
      session_id?: string
    }
    const skill = deps.registry.get(params.name)

    if (!skill) {
      return reply.code(404).send({
        ok: false,
        error: {
          code: 'skill_not_found',
          message: `Unknown skill "${params.name}"`,
        },
      })
    }

    const traceId = randomUUID()
    const startedAt = Date.now()
    const result = await skill.execute(
      String(body.action || ''),
      body.payload || {},
      createSkillExecutionContext({
        traceId,
        sessionId: body.session_id,
        logger: createLogger(),
      }),
    )

    const statusCode = result.ok ? 200 : 400
    return reply.code(statusCode).send({
      ok: result.ok,
      skill: params.name,
      action: body.action || null,
      data: result.data,
      error: result.error,
      trace_id: traceId,
      latency_ms: Date.now() - startedAt,
    })
  })
}

