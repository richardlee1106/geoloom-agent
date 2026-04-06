import { describe, expect, it, vi } from 'vitest'

import { executeSpatialSQLAction } from '../../../../src/skills/postgis/actions/executeSQL.js'
import { SQLSandbox } from '../../../../src/sandbox/SQLSandbox.js'
import { createPostgisCatalog } from '../../../../src/skills/postgis/sqlSecurity.js'

const validSql = `
  SELECT id, name
  FROM pois
  WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
    800
  )
  LIMIT 10
`

function createSandbox() {
  return new SQLSandbox({
    catalog: createPostgisCatalog(),
    maxRows: 2,
    statementTimeoutMs: 1200,
  })
}

describe('executeSpatialSQLAction', () => {
  it('executes a validated read-only query successfully', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 1, name: 'A' }],
      rowCount: 1,
    }))

    const result = await executeSpatialSQLAction(
      {
        sql: validSql,
      },
      {
        sandbox: createSandbox(),
        query,
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.rows).toHaveLength(1)
    expect(query).toHaveBeenCalledOnce()
  })

  it('surfaces timeout errors from the executor', async () => {
    const result = await executeSpatialSQLAction(
      {
        sql: validSql,
      },
      {
        sandbox: createSandbox(),
        query: async () => {
          throw new Error('statement timeout')
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/timeout/i)
  })

  it('truncates rows above the configured maximum', async () => {
    const result = await executeSpatialSQLAction(
      {
        sql: validSql,
      },
      {
        sandbox: createSandbox(),
        query: async () => ({
          rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
          rowCount: 3,
        }),
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.rows).toHaveLength(2)
    expect(result.data?.meta.truncated).toBe(true)
  })

  it('records audit data for successful executions', async () => {
    const result = await executeSpatialSQLAction(
      {
        sql: validSql,
      },
      {
        sandbox: createSandbox(),
        query: async () => ({
          rows: [{ id: 1 }],
          rowCount: 1,
        }),
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.audit.sqlHash).toMatch(/[a-f0-9]{64}/)
  })
})

