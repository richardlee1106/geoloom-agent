import type { FastifyInstance } from 'fastify'

import type { SkillRegistry } from '../skills/SkillRegistry.js'

export async function registerGeoRoutes(
  app: FastifyInstance,
  deps: {
    registry: SkillRegistry
    version: string
    checkDatabaseHealth: () => Promise<boolean>
    chat?: {
      getHealth?(): Promise<Record<string, unknown>> | Record<string, unknown>
    }
  },
) {
  app.get('/health', async () => {
    const databaseHealthy = await deps.checkDatabaseHealth()
      .then(() => true)
      .catch(() => false)
    const chatHealth = await Promise.resolve(deps.chat?.getHealth?.() || {})
    const databaseDependency = {
      name: 'database',
      ready: databaseHealthy,
      mode: 'remote' as const,
      degraded: !databaseHealthy,
      reason: databaseHealthy ? null : 'connection_failed',
    }
    const dependencies = {
      ...(chatHealth.dependencies as Record<string, unknown> | undefined || {}),
      database: databaseDependency,
    }
    const degradedDependencies = new Set<string>([
      ...(chatHealth.degraded_dependencies as string[] | undefined || []),
    ])
    if (!databaseHealthy) {
      degradedDependencies.add('database')
    }

    return {
      status: 'ok',
      version: deps.version,
      services: {
        database: databaseHealthy ? 'connected' : 'disconnected',
      },
      llm: chatHealth.llm || {
        ready: false,
      },
      memory: chatHealth.memory || {
        ready: false,
      },
      metrics: chatHealth.metrics || null,
      provider_ready: chatHealth.provider_ready || false,
      dependencies,
      degraded_dependencies: [...degradedDependencies],
      skills: deps.registry.list().map((skill) => ({
        name: skill.name,
        actions: skill.actions.map((action) => action.name),
      })),
      skills_registered: deps.registry.size(),
    }
  })
}
