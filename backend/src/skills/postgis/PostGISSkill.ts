import { getSchemaCatalogAction } from './actions/getSchemaCatalog.js'
import { resolveAnchorAction } from './actions/resolveAnchor.js'
import { validateSpatialSQLAction } from './actions/validateSQL.js'
import { executeSpatialSQLAction } from './actions/executeSQL.js'
import { createPostgisCatalog, type PostgisCatalog } from './sqlSecurity.js'
import type { SQLSandbox } from '../../sandbox/SQLSandbox.js'
import type { QueryResultLike } from '../../integration/postgisPool.js'
import type {
  SkillActionDefinition,
  SkillDefinition,
  SkillExecutionContext,
  SkillExecutionResult,
} from '../types.js'

interface AnchorCandidate {
  id?: string | number
  name: string
  lon?: number
  lat?: number
  distance_m?: number
  category_main?: string
  category_sub?: string
  category_big?: string
  category_mid?: string
  category_small?: string
}

export interface CreatePostgisSkillOptions {
  catalog?: PostgisCatalog
  sandbox: SQLSandbox
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>
  searchCandidates: (placeName: string, variants: string[]) => Promise<AnchorCandidate[]>
  healthcheck?: () => Promise<boolean>
}

const postgisActions: Record<string, SkillActionDefinition> = {
  get_schema_catalog: {
    name: 'get_schema_catalog',
    description: '返回 V4 允许访问的最小 schema 目录',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { tables: { type: 'object' } } },
  },
  resolve_anchor: {
    name: 'resolve_anchor',
    description: '离线规则 + POI 模糊检索的锚点解析',
    inputSchema: {
      type: 'object',
      required: ['place_name'],
      properties: {
        place_name: { type: 'string' },
        role: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        anchor: { type: 'object' },
      },
    },
  },
  validate_spatial_sql: {
    name: 'validate_spatial_sql',
    description: '执行 SQL 白名单、AST 和空间谓词校验',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array' },
      },
    },
  },
  execute_spatial_sql: {
    name: 'execute_spatial_sql',
    description: '执行经过校验的只读模板化 SQL',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array' },
        meta: { type: 'object' },
        audit: { type: 'object' },
      },
    },
  },
}

export function createPostgisSkill(options: CreatePostgisSkillOptions): SkillDefinition {
  const catalog = options.catalog || createPostgisCatalog()

  return {
    name: 'postgis',
    description: 'V4 Phase 0-1 的最小 PostGIS skill 闭环',
    capabilities: ['catalog', 'anchor_resolution', 'sql_validation', 'sql_execution'],
    actions: postgisActions,
    async execute(action, payload, _context: SkillExecutionContext): Promise<SkillExecutionResult> {
      switch (action) {
        case 'get_schema_catalog':
          return getSchemaCatalogAction({}, { catalog })
        case 'resolve_anchor':
          return resolveAnchorAction(payload as { place_name: string, role?: string }, {
            searchCandidates: options.searchCandidates,
          })
        case 'validate_spatial_sql':
          return validateSpatialSQLAction(payload as { sql: string }, {
            catalog,
            sandbox: options.sandbox,
          })
        case 'execute_spatial_sql':
          return executeSpatialSQLAction(payload as { sql: string }, {
            sandbox: options.sandbox,
            query: options.query,
          })
        default:
          return {
            ok: false,
            error: {
              code: 'unknown_action',
              message: `Unknown postgis action "${action}"`,
            },
            meta: {
              action,
              audited: false,
            },
          }
      }
    },
  }
}
