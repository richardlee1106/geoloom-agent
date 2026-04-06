import { describe, expect, it } from 'vitest'

import { buildPostgisPoolConfig } from '../../../src/integration/postgisPool.js'

describe('buildPostgisPoolConfig', () => {
  it('defaults to the local docker port 15432 when no overrides are provided', () => {
    const config = buildPostgisPoolConfig({})

    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(15432)
    expect(config.database).toBe('geoloom')
  })

  it('prefers explicit overrides over env defaults', () => {
    const config = buildPostgisPoolConfig(
      {
        POSTGRES_HOST: 'env-host',
        POSTGRES_PORT: '15432',
        POSTGRES_USER: 'env-user',
        POSTGRES_PASSWORD: 'env-pass',
        POSTGRES_DATABASE: 'env-db',
        POSTGRES_POOL_MAX: '6',
      },
      {
        host: 'override-host',
        port: 19999,
        user: 'override-user',
        password: 'override-pass',
        database: 'override-db',
        max: 12,
      },
    )

    expect(config.host).toBe('override-host')
    expect(config.port).toBe(19999)
    expect(config.user).toBe('override-user')
    expect(config.password).toBe('override-pass')
    expect(config.database).toBe('override-db')
    expect(config.max).toBe(12)
  })
})
