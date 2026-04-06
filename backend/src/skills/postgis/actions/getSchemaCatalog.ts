import type { PostgisCatalog } from '../sqlSecurity.js'
import type { SkillExecutionResult } from '../../types.js'

export async function getSchemaCatalogAction(
  _payload: Record<string, never>,
  deps: {
    catalog: PostgisCatalog
  },
): Promise<SkillExecutionResult<{ tables: PostgisCatalog['tables'], functions: string[], maxLimit: number }>> {
  return {
    ok: true,
    data: {
      tables: deps.catalog.tables,
      functions: deps.catalog.functions,
      maxLimit: deps.catalog.maxLimit,
    },
    meta: {
      action: 'get_schema_catalog',
      audited: true,
    },
  }
}

