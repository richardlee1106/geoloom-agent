import type { SkillExecutionResult } from '../../types.js'
import type { SQLSandbox } from '../../../sandbox/SQLSandbox.js'
import type { QueryResultLike } from '../../../integration/postgisPool.js'

export async function executeSpatialSQLAction(
  payload: {
    sql: string
  },
  deps: {
    sandbox: SQLSandbox
    query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>
  },
): Promise<SkillExecutionResult<{
  rows: Record<string, unknown>[]
  meta: Record<string, unknown>
  audit: Record<string, unknown>
}>> {
  try {
    const execution = await deps.sandbox.execute({
      sql: payload.sql,
      executor: async ({ sql, timeoutMs }) => deps.query(sql, [], timeoutMs),
    })

    return {
      ok: true,
      data: execution,
      meta: {
        action: 'execute_spatial_sql',
        audited: true,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'sql_execution_failed',
        message: error instanceof Error ? error.message : 'SQL execution failed',
      },
      meta: {
        action: 'execute_spatial_sql',
        audited: true,
      },
    }
  }
}

