import { describe, expect, it } from 'vitest'

import { validateSpatialSQLAction } from '../../../../src/skills/postgis/actions/validateSQL.js'
import { createPostgisCatalog } from '../../../../src/skills/postgis/sqlSecurity.js'

const catalog = createPostgisCatalog()

describe('validateSpatialSQLAction', () => {
  it('passes a valid nearby POI template query', async () => {
    const result = await validateSpatialSQLAction(
      {
        sql: `
          SELECT id, name
          FROM pois
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
            800
          )
          LIMIT 20
        `,
      },
      { catalog },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.valid).toBe(true)
  })

  it('rejects mutation statements', async () => {
    const result = await validateSpatialSQLAction(
      { sql: 'DELETE FROM pois WHERE id = 1' },
      { catalog },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/delete/i)
  })

  it('rejects a query without limit', async () => {
    const result = await validateSpatialSQLAction(
      {
        sql: `
          SELECT id
          FROM pois
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
            800
          )
        `,
      },
      { catalog },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/limit/i)
  })

  it('rejects a query without a spatial predicate', async () => {
    const result = await validateSpatialSQLAction(
      {
        sql: "SELECT id FROM pois WHERE name ILIKE '%咖啡%' LIMIT 20",
      },
      { catalog },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/空间/i)
  })

  it('rejects a non-whitelisted function', async () => {
    const result = await validateSpatialSQLAction(
      {
        sql: `
          SELECT pg_sleep(1)
          FROM pois
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
            800
          )
          LIMIT 20
        `,
      },
      { catalog },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/function/i)
  })

  it('rejects a non-whitelisted table', async () => {
    const result = await validateSpatialSQLAction(
      {
        sql: `
          SELECT id
          FROM users
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(114.3, 30.5), 4326)::geography,
            800
          )
          LIMIT 20
        `,
      },
      { catalog },
    )

    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/table/i)
  })
})

