import type { FastifyInstance } from 'fastify'

import { flattenCategoryTree, type CategoryTreeNode } from '../catalog/categoryCatalog.js'

export async function registerCategoryRoutes(
  app: FastifyInstance,
  deps: {
    getCategoryTree: () => Promise<CategoryTreeNode[]>
  },
) {
  app.get('/tree', async (_request, reply) => {
    try {
      return await deps.getCategoryTree()
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        error: 'Failed to load categories',
        details: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  app.get('/flat', async (_request, reply) => {
    try {
      const tree = await deps.getCategoryTree()
      return flattenCategoryTree(tree)
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        error: 'Failed to load flat categories',
        details: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })
}
