import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'

import type { ChatRequestV4 } from './chat/types.js'
import type { SSEWriter } from './chat/SSEWriter.js'
import { registerChatRoutes } from './routes/chat.js'
import type { SkillRegistry } from './skills/SkillRegistry.js'
import { registerGeoRoutes } from './routes/geo.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerCategoryRoutes } from './routes/category.js'
import type { CategoryTreeNode } from './catalog/categoryCatalog.js'

export interface ChatRuntime {
  createWriter(stream: NodeJS.WritableStream, traceId?: string): SSEWriter
  handle(request: ChatRequestV4, writer: SSEWriter): Promise<void>
  getHealth?(): Promise<Record<string, unknown>> | Record<string, unknown>
}

export interface CreateAppOptions {
  registry: SkillRegistry
  version: string
  checkDatabaseHealth: () => Promise<boolean>
  getCategoryTree?: () => Promise<CategoryTreeNode[]>
  chat?: ChatRuntime
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
  })

  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  })

  app.register(async (scope) => {
    await registerCategoryRoutes(scope, {
      getCategoryTree: options.getCategoryTree || (async () => []),
    })
  }, { prefix: '/api/category' })

  app.register(async (scope) => {
    await registerGeoRoutes(scope, options)
    await registerSkillRoutes(scope, options)
    if (options.chat) {
      await registerChatRoutes(scope, { chat: options.chat })
    }
  }, { prefix: '/api/geo' })

  return app
}
