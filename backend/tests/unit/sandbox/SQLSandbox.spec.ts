import { describe, expect, it } from 'vitest'

import { SQLSandbox } from '../../../src/sandbox/SQLSandbox.js'

const baseCatalog = {
  tables: {
    pois: [
      'id',
      'name',
      'address',
      'type',
      'category_main',
      'category_sub',
      'category_big',
      'category_mid',
      'category_small',
      'geom',
    ],
    subway_stations: ['id', 'name', 'geom'],
    aois: ['id', 'osm_id', 'code', 'fclass', 'name', 'population', 'area_sqm', 'geom'],
    landuse: ['id', 'land_type', 'area_sqm', 'geom'],
  },
  functions: [
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'st_dwithin',
    'st_distance',
    'st_setsrid',
    'st_makepoint',
    'st_x',
    'st_y',
    'st_intersects',
    'st_contains',
    'st_buffer',
    'st_astext',
    'st_geomfromtext',
    'st_squaregrid',
    'st_snaptogrid',
    'row_number',
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

const histogramQuery = `
  SELECT category_main, COUNT(id) AS poi_count
  FROM pois
  WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
    1200
  )
  GROUP BY category_main
  ORDER BY poi_count DESC
`

const hotspotGridQuery = `
  SELECT
    ST_AsText(grid.geom) AS grid_wkt,
    COUNT(p.id) AS poi_count
  FROM ST_SquareGrid(
    0.002,
    ST_Buffer(
      ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
      1200
    )::geometry
  ) AS grid
  LEFT JOIN pois p
    ON ST_Intersects(p.geom, grid.geom)
    AND ST_DWithin(
      p.geom::geography,
      ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
      1200
    )
  GROUP BY grid.geom
  HAVING COUNT(p.id) > 0
  ORDER BY poi_count DESC
  LIMIT 5
`

const aoiContextQuery = `
  SELECT id, name, fclass, code, population, area_sqm
  FROM aois
  WHERE ST_Intersects(
    geom,
    ST_Buffer(
      ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
      1200
    )::geometry
  )
  ORDER BY population DESC NULLS LAST, area_sqm DESC
  LIMIT 5
`

const landuseContextQuery = `
  SELECT land_type, COUNT(id) AS parcel_count, SUM(area_sqm) AS total_area_sqm
  FROM landuse
  WHERE ST_Intersects(
    geom,
    ST_Buffer(
      ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
      1200
    )::geometry
  )
  GROUP BY land_type
  ORDER BY total_area_sqm DESC
  LIMIT 6
`

const viewportPolygonQuery = `
  SELECT id, name
  FROM pois
  WHERE ST_Intersects(
    geom,
    ST_GeomFromText('POLYGON((114.3 30.54, 114.38 30.54, 114.38 30.6, 114.3 30.6, 114.3 30.54))', 4326)
  )
  LIMIT 10
`

const representativeSampleQuery = `
  SELECT id, name, category_main, category_sub, distance_m
  FROM (
    SELECT
      id,
      name,
      category_main,
      category_sub,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography
      ) AS distance_m,
      ROW_NUMBER() OVER (
        PARTITION BY ST_AsText(ST_SnapToGrid(geom, 0.0015, 0.0015))
        ORDER BY ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography
        ) ASC, id
      ) AS cell_rank
    FROM pois
    WHERE ST_Intersects(
      geom,
      ST_GeomFromText('POLYGON((114.3 30.54, 114.38 30.54, 114.38 30.6, 114.3 30.6, 114.3 30.54))', 4326)
    )
  ) sampled
  WHERE cell_rank = 1
  LIMIT 18
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

  it('accepts aggregation queries without a limit when they stay inside a spatial filter', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(histogramQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts hotspot grid queries that use ST_SquareGrid in the FROM clause', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(hotspotGridQuery)

    expect(result.ok).toBe(true)
    expect(result.meta.tables).toContain('pois')
    expect(result.meta.tables).not.toContain('st_squaregrid')
  })

  it('accepts AOI context queries against the aois table', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(aoiContextQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.meta.tables).toContain('aois')
  })

  it('accepts landuse aggregation queries against the landuse table', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(landuseContextQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.meta.tables).toContain('landuse')
  })

  it('ignores WKT literals when validating ST_GeomFromText area filters', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(viewportPolygonQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.meta.functions).toContain('st_geomfromtext')
  })

  it('accepts representative sample queries that use window functions over derived rows', () => {
    const sandbox = createSandbox()
    const result = sandbox.validate(representativeSampleQuery)

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.meta.functions).toContain('row_number')
    expect(result.meta.functions).not.toContain('over')
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
