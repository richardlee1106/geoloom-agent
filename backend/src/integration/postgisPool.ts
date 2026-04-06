import { Pool } from 'pg'

export interface PostgisPoolOptions {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  max?: number
  queryTimeoutMs?: number
}

export interface QueryResultLike {
  rows: Record<string, unknown>[]
  rowCount: number
}

export interface PostgisEnvLike {
  POSTGRES_HOST?: string
  POSTGRES_PORT?: string
  POSTGRES_USER?: string
  POSTGRES_PASSWORD?: string
  POSTGRES_DATABASE?: string
  POSTGRES_POOL_MAX?: string
}

export function buildPostgisPoolConfig(
  env: PostgisEnvLike = process.env,
  options: PostgisPoolOptions = {},
) {
  return {
    host: options.host || env.POSTGRES_HOST || '127.0.0.1',
    port: options.port || Number(env.POSTGRES_PORT || '15432'),
    user: options.user || env.POSTGRES_USER || 'postgres',
    password: options.password || env.POSTGRES_PASSWORD || '123456',
    database: options.database || env.POSTGRES_DATABASE || 'geoloom',
    max: options.max || Number(env.POSTGRES_POOL_MAX || '10'),
  }
}

export class PostgisPool {
  private readonly pool: Pool
  private readonly queryTimeoutMs: number

  constructor(options: PostgisPoolOptions = {}) {
    this.queryTimeoutMs = options.queryTimeoutMs || 5000
    this.pool = new Pool(buildPostgisPoolConfig(process.env, options))
  }

  async query(sql: string, params: unknown[] = [], timeoutMs = this.queryTimeoutMs): Promise<QueryResultLike> {
    const client = await this.pool.connect()
    try {
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, timeoutMs)}`)
      const result = await client.query(sql, params)
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount || 0,
      }
    } finally {
      client.release()
    }
  }

  async healthcheck() {
    await this.pool.query('SELECT 1')
    return true
  }

  async close() {
    await this.pool.end()
  }
}
