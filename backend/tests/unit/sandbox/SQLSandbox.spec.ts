import { describe, expect, it } from 'vitest'

import { SQLSandbox } from '../../../src/sandbox/SQLSandbox.js'

const baseCatalog = {
  tables: {
    pois: [
      'id',
      'name',
      'address',
      'type',
      'category_big',
      'category_mid',
      'category_small',
      'geom',
    ],
    subway_stations: ['id', 'name', 'geom'],
  },
  functions: [
    'st_dwithin',
    'st_distance',
    'st_setsrid',
    'st_makepoint',
    'st_x',
    'st_y',
    'st_intersects',
    'st_contains',
    'st_buffer',
  ],
  requiredSpatialFunctions: ['st_dwithin', 'st_intersects', 'st_contains'],
  maxLimit: 200,
}

function createSandbox() {
  return new SQLSandbox({
    catalog: baseCatalog,
    maxRows: 3,
    statementTimeoutMs: 1500,
  })
}

const validQuery = `
  SELECT id, name
  FROM pois
  WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
    800
  )
  LIMIT 10
`

describe('SQLSandbox', () => {
  it('accepts a valid spatial select query', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(validQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects insert statements', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('INSERT INTO pois(id) VALUES (1)')
    expect(result.ok).toBe(false)
  })

  it('rejects update statements', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('UPDATE pois SET name = \'x\' LIMIT 1')
    expect(result.ok).toBe(false)
  })

  it('rejects delete statements', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('DELETE FROM pois WHERE id = 1')
    expect(result.ok).toBe(false)
  })

  it('rejects drop statements', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('DROP TABLE pois')
    expect(result.ok).toBe(false)
  })

  it('rejects alter statements', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('ALTER TABLE pois ADD COLUMN x text')
    expect(result.ok).toBe(false)
  })

  it('rejects queries without a limit', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT id FROM pois WHERE ST_DWithin(geom::geography, geom::geography, 1)')
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/limit/i)
  })

  it('rejects queries that exceed the max limit', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(validQuery.replace('LIMIT 10', 'LIMIT 500'))
    expect(result.ok).toBe(false)
  })

  it('rejects non-whitelisted tables', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT id FROM users WHERE ST_DWithin(geom::geography, geom::geography, 1) LIMIT 10')
    expect(result.ok).toBe(false)
  })

  it('rejects non-whitelisted columns', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT secret_column FROM pois WHERE ST_DWithin(geom::geography, geom::geography, 1) LIMIT 10')
    expect(result.ok).toBe(false)
  })

  it('rejects non-whitelisted functions', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT pg_sleep(1) FROM pois WHERE ST_DWithin(geom::geography, geom::geography, 1) LIMIT 10')
    expect(result.ok).toBe(false)
  })

  it('rejects spatial queries without a required spatial predicate', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT id FROM pois WHERE name ILIKE \'%咖啡%\' LIMIT 10')
    expect(result.ok).toBe(false)
  })

  it('rejects multiple statements in a single payload', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(`${validQuery}; SELECT * FROM pois LIMIT 1`)
    expect(result.ok).toBe(false)
  })

  it('rejects wildcard column selection', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT * FROM pois WHERE ST_DWithin(geom::geography, geom::geography, 1) LIMIT 10')
    expect(result.ok).toBe(false)
  })

  it('passes validation metadata back to callers', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(validQuery)
    expect(result.meta.limit).toBe(10)
    expect(result.meta.tables).toContain('pois')
  })

  it('executes validated SQL through the provided executor', async () => {
    const sandbox = createSandbox()
    const executed = await sandbox.execute({
      sql: validQuery,
      executor: async (statement) => {
        expect(statement.timeoutMs).toBe(1500)
        return {
          rows: [{ id: 1 }, { id: 2 }],
          rowCount: 2,
        }
      },
    })

    expect(executed.rows).toHaveLength(2)
    expect(executed.meta.truncated).toBe(false)
  })

  it('truncates rows that exceed maxRows', async () => {
    const sandbox = createSandbox()
    const executed = await sandbox.execute({
      sql: validQuery,
      executor: async () => ({
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
        rowCount: 4,
      }),
    })

    expect(executed.rows).toHaveLength(3)
    expect(executed.meta.truncated).toBe(true)
  })

  it('records audit data for successful execution', async () => {
    const sandbox = createSandbox()
    const executed = await sandbox.execute({
      sql: validQuery,
      executor: async () => ({
        rows: [{ id: 1 }],
        rowCount: 1,
      }),
    })

    expect(executed.audit.sqlHash).toMatch(/[a-f0-9]{64}/)
    expect(executed.audit.rowCount).toBe(1)
  })

  it('propagates executor timeout errors', async () => {
    const sandbox = createSandbox()

    await expect(
      sandbox.execute({
        sql: validQuery,
        executor: async () => {
          throw new Error('statement timeout')
        },
      }),
    ).rejects.toThrow(/timeout/i)
  })

  it('requires validation before execution', async () => {
    const sandbox = createSandbox()

    await expect(
      sandbox.execute({
        sql: 'SELECT id FROM pois LIMIT 1',
        executor: async () => ({ rows: [], rowCount: 0 }),
      }),
    ).rejects.toThrow(/validation/i)
  })

  it('normalizes validation errors into a stable shape', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate('SELECT id FROM missing LIMIT 1')
    expect(Array.isArray(result.errors)).toBe(true)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
