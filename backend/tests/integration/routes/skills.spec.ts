import { describe, expect, it } from 'vitest'

import { createApp } from '../../../src/app.js'
import { createPostgisSkill } from '../../../src/skills/postgis/PostGISSkill.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'
import { createPostgisCatalog } from '../../../src/skills/postgis/sqlSecurity.js'
import { SQLSandbox } from '../../../src/sandbox/SQLSandbox.js'

function buildTestApp() {
  const registry = new SkillRegistry()
  const sandbox = new SQLSandbox({
    catalog: createPostgisCatalog(),
    maxRows: 50,
    statementTimeoutMs: 1000,
  })

  registry.register(
    createPostgisSkill({
      catalog: createPostgisCatalog(),
      sandbox,
      query: async (sql) => {
        if (sql.includes('FROM pois')) {
          return {
            rows: [{ id: 1, name: '武汉大学' }],
            rowCount: 1,
          }
        }
        return {
          rows: [],
          rowCount: 0,
        }
      },
      searchCandidates: async () => [
        {
          id: 1,
          name: '武汉大学',
          lon: 114.3655,
          lat: 30.5431,
          category_big: '科教文化服务',
          category_mid: '学校',
          category_small: '高等院校',
        },
      ],
      healthcheck: async () => true,
    }),
  )

  return createApp({
    registry,
    version: '0.1.0-test',
    checkDatabaseHealth: async () => true,
  })
}

describe('skills routes', () => {
  it('returns the registered postgis skill', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/geo/skills',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().skills[0].name).toBe('postgis')
    await app.close()
  })

  it('runs get_schema_catalog through the postgis debug route', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/skills/postgis/call',
      payload: {
        action: 'get_schema_catalog',
        payload: {},
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().ok).toBe(true)
    expect(response.json().data.tables.pois).toBeDefined()
    await app.close()
  })

  it('rejects illegal SQL through the postgis debug route', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/skills/postgis/call',
      payload: {
        action: 'validate_spatial_sql',
        payload: {
          sql: 'DELETE FROM pois WHERE id = 1',
        },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().ok).toBe(false)
    await app.close()
  })
})
