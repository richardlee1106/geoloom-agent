import type { PostgisCatalog } from '../sqlSecurity.js'
import type { SkillExecutionResult } from '../../types.js'
import type { SQLSandbox } from '../../../sandbox/SQLSandbox.js'
import { SQLSandbox as SQLSandboxImpl } from '../../../sandbox/SQLSandbox.js'

export async function validateSpatialSQLAction(
  payload: {
    sql: string
  },
  deps: {
    sandbox?: SQLSandbox
    catalog: PostgisCatalog
  },
): Promise<SkillExecutionResult<{ valid: boolean, errors: string[], meta: Record<string, unknown> }>> {
  const sandbox = deps.sandbox || new SQLSandboxImpl({
    catalog: deps.catalog,
    maxRows: deps.catalog.maxLimit,
    statementTimeoutMs: 3000,
  })
  const validation = sandbox.validate(payload.sql)

  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: 'sql_validation_failed',
        message: validation.errors.join('; '),
        details: validation,
      },
      meta: {
        action: 'validate_spatial_sql',
        audited: true,
      },
    }
  }

  return {
    ok: true,
    data: {
      valid: true,
      errors: [],
      meta: validation.meta,
    },
    meta: {
      action: 'validate_spatial_sql',
      audited: true,
    },
  }
}
