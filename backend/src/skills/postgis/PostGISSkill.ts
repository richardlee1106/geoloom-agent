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

const POSTGIS_TEMPLATE_NAMES = [
  'nearby_poi',
  'nearest_station',
  'compare_places',
  'area_overview',
  'area_category_histogram',
  'area_ring_distribution',
  'area_representative_sample',
  'area_competition_density',
  'area_h3_hotspots',
  'area_aoi_context',
  'area_landuse_context',
] as const

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
      properties: {
        place_name: { type: 'string', description: '标准锚点字段，优先使用。' },
        placeName: { type: 'string' },
        anchor_text: { type: 'string' },
        anchor_name: { type: 'string' },
        anchorName: { type: 'string' },
        anchor: { type: 'string' },
        place: { type: 'string' },
        query: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string' },
      },
      anyOf: [
        { type: 'object', required: ['place_name'] },
        { type: 'object', required: ['placeName'] },
        { type: 'object', required: ['anchor_text'] },
        { type: 'object', required: ['anchor_name'] },
        { type: 'object', required: ['anchorName'] },
        { type: 'object', required: ['anchor'] },
        { type: 'object', required: ['place'] },
        { type: 'object', required: ['query'] },
        { type: 'object', required: ['name'] },
      ],
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
    description: '执行只读空间查询。优先使用 template 模式，让系统按当前锚点和上下文自动组装安全 SQL；只有在没有模板可用时才传 sql。',
    inputSchema: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          required: ['template'],
          properties: {
            template: {
              type: 'string',
              enum: [...POSTGIS_TEMPLATE_NAMES],
              description: '优先使用模板，不要为常见空间问题手写 SQL。',
            },
            category_key: { type: 'string' },
            categoryKey: { type: 'string' },
            limit: { type: 'number' },
            map_view: {
              type: 'object',
              properties: {},
              additionalProperties: true,
              description: '当问题针对当前地图视口时，可以传一个空对象表示沿用当前 map_view。',
            },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['sql'],
          properties: {
            sql: {
              type: 'string',
              description: '仅在没有模板可用时使用。必须是只读 SQL，并且带空间过滤与 LIMIT。',
            },
          },
          additionalProperties: false,
        },
      ],
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
