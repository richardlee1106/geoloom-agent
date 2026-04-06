import { describe, expect, it } from 'vitest'

import { createApp } from '../../../src/app.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

describe('GET /api/category/tree', () => {
  it('returns the category tree expected by the control panel', async () => {
    const app = createApp({
      registry: new SkillRegistry(),
      version: '0.3.1-test',
      checkDatabaseHealth: async () => true,
      getCategoryTree: async () => [
        {
          value: '生活服务',
          label: '生活服务',
          count: 42,
          children: [
            {
              value: '咖啡厅',
              label: '咖啡厅',
              count: 12,
              children: [
                {
                  value: '精品咖啡',
                  label: '精品咖啡',
                  count: 7,
                },
              ],
            },
          ],
        },
      ],
    })
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/category/tree',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      {
        value: '生活服务',
        label: '生活服务',
        count: 42,
        children: [
          {
            value: '咖啡厅',
            label: '咖啡厅',
            count: 12,
            children: [
              {
                value: '精品咖啡',
                label: '精品咖啡',
                count: 7,
              },
            ],
          },
        ],
      },
    ])

    await app.close()
  })
})
