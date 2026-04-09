import { type FastifyInstance } from 'fastify'
import { vi } from 'vitest'

import { ConversationMemory } from '../../../src/agent/ConversationMemory.js'
import { GeoLoomAgent } from '../../../src/agent/GeoLoomAgent.js'
import { SessionManager } from '../../../src/agent/SessionManager.js'
import { createApp } from '../../../src/app.js'
import { loadRuntimeEnv } from '../../../src/config/loadRuntimeEnv.js'
import { InMemoryLLMProvider } from '../../../src/llm/InMemoryLLMProvider.js'
import { createDefaultLLMProvider } from '../../../src/llm/createDefaultLLMProvider.js'
import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js'
import { LongTermMemory } from '../../../src/memory/LongTermMemory.js'
import { MemoryManager } from '../../../src/memory/MemoryManager.js'
import { ProfileManager } from '../../../src/memory/ProfileManager.js'
import { ShortTermMemory } from '../../../src/memory/ShortTermMemory.js'
import { SQLSandbox } from '../../../src/sandbox/SQLSandbox.js'
import { SkillManifestLoader } from '../../../src/skills/SkillManifestLoader.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'
import { createPostgisSkill } from '../../../src/skills/postgis/PostGISSkill.js'
import { createPostgisCatalog } from '../../../src/skills/postgis/sqlSecurity.js'
import { createRouteDistanceSkill } from '../../../src/skills/route_distance/RouteDistanceSkill.js'
import { createSpatialEncoderSkill } from '../../../src/skills/spatial_encoder/SpatialEncoderSkill.js'
import { createSpatialVectorSkill } from '../../../src/skills/spatial_vector/SpatialVectorSkill.js'

loadRuntimeEnv()

export type RegressionProviderMode =
  | 'default'
  | 'env_default'
  | 'nearest_station_recovery'
  | 'provider_unavailable'
  | 'polished_answer'
  | 'compare_metro'
  | 'provider_throwing'

function createMockLLMResponse(input: {
  message?: string | null
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  finishReason: 'tool_calls' | 'stop'
}): LLMResponse {
  const toolCalls = input.toolCalls || []

  return {
    assistantMessage: {
      role: 'assistant',
      content: input.message ?? null,
      toolCalls,
    },
    toolCalls,
    finishReason: input.finishReason,
  }
}

function hasToolResult(messages: Array<{ role: string, name?: string, content: string | null }>, skillName: string, predicate: (payload: Record<string, unknown>) => boolean) {
  return messages
    .filter((message) => message.role === 'tool' && message.name === skillName)
    .some((message) => {
      try {
        return predicate(JSON.parse(message.content || '{}'))
      } catch {
        return false
      }
    })
}

function createProvider(mode: RegressionProviderMode = 'default'): LLMProvider {
  if (mode === 'env_default') {
    return createDefaultLLMProvider()
  }

  if (mode === 'nearest_station_recovery') {
    return {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-misaligned-provider',
        model: 'mock-misaligned-provider-v1',
      }),
      complete: async ({ messages }) => {
        const hasAnyToolResult = messages.some((message) => message.role === 'tool')

        if (!hasAnyToolResult) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_encode_region',
                name: 'spatial_encoder',
                arguments: {
                  action: 'encode_region',
                  payload: {
                    region_name: '武汉大学',
                  },
                },
              },
              {
                id: 'tool_search_semantic_station',
                name: 'spatial_vector',
                arguments: {
                  action: 'search_semantic_pois',
                  payload: {
                    query: '武汉大学地铁站',
                    region: '武汉',
                  },
                },
              },
            ],
          })
        }

        return createMockLLMResponse({
          message: '请基于已有证据给出明确结论。',
          finishReason: 'stop',
          toolCalls: [],
        })
      },
    }
  }

  if (mode === 'provider_unavailable') {
    return {
      isReady: () => false,
      getStatus: () => ({
        ready: false,
        provider: 'mock-unavailable',
        model: null,
      }),
      complete: async () => createMockLLMResponse({
        message: null,
        toolCalls: [],
        finishReason: 'stop',
      }),
    }
  }

  if (mode === 'polished_answer') {
    return {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-polisher',
        model: 'mock-polisher-v1',
      }),
      complete: async ({ messages }) => {
        if (!hasToolResult(messages, 'postgis', (payload) => Boolean(payload.anchor))) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_resolve_anchor',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '武汉大学',
                    role: 'primary',
                  },
                },
              },
            ],
          })
        }

        if (!hasToolResult(messages, 'postgis', (payload) => Array.isArray(payload.rows))) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_execute_sql',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: {
                    template: 'nearby_poi',
                    category_key: 'coffee',
                    limit: 5,
                  },
                },
              },
            ],
          })
        }

        return createMockLLMResponse({
          message: '这是来自大模型的最终结论：武汉大学附近咖啡密度高，首选 luckin coffee。',
          finishReason: 'stop',
          toolCalls: [],
        })
      },
    }
  }

  if (mode === 'compare_metro') {
    return {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-compare',
        model: 'mock-compare-v1',
      }),
      complete: async ({ messages }) => {
        const resolvedAnchors = messages
          .filter((message) => message.role === 'tool' && message.name === 'postgis')
          .map((message) => {
            try {
              return JSON.parse(message.content || '{}')
            } catch {
              return {}
            }
          })
          .filter((payload) => payload.anchor)

        if (resolvedAnchors.length === 0) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_compare_primary',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '武汉大学',
                    role: 'primary',
                  },
                },
              },
              {
                id: 'tool_compare_secondary',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '湖北大学',
                    role: 'secondary',
                  },
                },
              },
            ],
          })
        }

        if (!hasToolResult(messages, 'postgis', (payload) => Array.isArray(payload.comparison_pairs))) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_compare_sql',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: {
                    template: 'compare_places',
                    category_key: 'metro_station',
                    limit: 8,
                  },
                },
              },
            ],
          })
        }

        return createMockLLMResponse({
          message: '对比完成。',
          finishReason: 'stop',
          toolCalls: [],
        })
      },
    }
  }

  if (mode === 'provider_throwing') {
    return {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-throwing',
        model: 'mock-throwing-v1',
      }),
      complete: async () => {
        throw new Error('upstream llm timeout')
      },
    }
  }

  return new InMemoryLLMProvider()
}

export function parseSSE(raw: string) {
  return raw
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = block
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice(7)
        .trim()
      const dataLine = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
      const data = dataLine ? JSON.parse(dataLine.slice(6)) : null
      return { event, data }
    })
}

export function buildRegressionApp(options: {
  providerMode?: RegressionProviderMode
} = {}): FastifyInstance {
  const registry = new SkillRegistry()
  const catalog = createPostgisCatalog()
  const sandbox = new SQLSandbox({
    catalog,
    maxRows: 20,
    statementTimeoutMs: 1200,
  })

  registry.register(
    createPostgisSkill({
      catalog,
      sandbox,
      query: vi.fn(async (sql) => {
        if (sql.includes('COUNT(id) AS poi_count') && sql.includes('GROUP BY category_main')) {
          return {
            rows: [
              { category_main: '餐饮美食', poi_count: 14 },
              { category_main: '购物服务', poi_count: 6 },
              { category_main: '交通设施服务', poi_count: 4 },
            ],
            rowCount: 3,
          }
        }

        if (sql.includes('AS ring_label') && sql.includes('GROUP BY ring_label, ring_order')) {
          return {
            rows: [
              { ring_label: '0-300m', ring_order: 1, poi_count: 12 },
              { ring_label: '300-600m', ring_order: 2, poi_count: 8 },
              { ring_label: '600-900m', ring_order: 3, poi_count: 4 },
            ],
            rowCount: 3,
          }
        }

        if (sql.includes('AVG(ST_Distance') && sql.includes('GROUP BY 1')) {
          return {
            rows: [
              { competition_key: '餐饮美食', poi_count: 14, nearest_distance_m: 52, avg_distance_m: 238 },
              { competition_key: '购物服务', poi_count: 6, nearest_distance_m: 136, avg_distance_m: 311 },
            ],
            rowCount: 2,
          }
        }

        if (sql.includes('ST_SquareGrid') && sql.includes('GROUP BY grid.geom')) {
          return {
            rows: [
              { grid_wkt: 'POLYGON((114.3295 30.5765,114.3322 30.5765,114.3322 30.5778,114.3295 30.5778,114.3295 30.5765))', poi_count: 9 },
              { grid_wkt: 'POLYGON((114.3330 30.5780,114.3345 30.5780,114.3345 30.5792,114.3330 30.5792,114.3330 30.5780))', poi_count: 5 },
            ],
            rowCount: 2,
          }
        }

        if (sql.includes('FROM aois')) {
          return {
            rows: [
              {
                id: 8101,
                name: '湖北大学生活区',
                fclass: 'residential',
                code: '3100',
                population: 2600,
                area_sqm: 180000,
              },
              {
                id: 8102,
                name: '三角路地铁商业带',
                fclass: 'commercial',
                code: '2100',
                population: null,
                area_sqm: 64000,
              },
            ],
            rowCount: 2,
          }
        }

        if (sql.includes('FROM landuse')) {
          return {
            rows: [
              { land_type: 'residential', parcel_count: 7, total_area_sqm: 86000 },
              { land_type: 'commercial', parcel_count: 4, total_area_sqm: 52000 },
              { land_type: 'education', parcel_count: 2, total_area_sqm: 43000 },
            ],
            rowCount: 3,
          }
        }

        if (sql.includes("category_sub = '咖啡'")) {
          return {
            rows: [
              {
                id: 1,
                name: 'luckin coffee',
                category_main: '餐饮美食',
                category_sub: '咖啡',
                longitude: 114.3651,
                latitude: 30.5368,
                distance_m: 123.7,
              },
            ],
            rowCount: 1,
          }
        }

        if (sql.includes("category_sub = '地铁站'") && sql.includes('114.33412099978432') && sql.includes('30.57687000005052')) {
          return {
            rows: [
              {
                id: 2101,
                name: '湖北大学地铁站E口',
                category_main: '交通设施服务',
                category_sub: '地铁站',
                longitude: 114.3308,
                latitude: 30.5772,
                distance_m: 268.4,
              },
              {
                id: 2102,
                name: '湖北大学地铁站A口',
                category_main: '交通设施服务',
                category_sub: '地铁站',
                longitude: 114.3312,
                latitude: 30.5775,
                distance_m: 312.1,
              },
              {
                id: 2103,
                name: '湖北大学地铁站D口',
                category_main: '交通设施服务',
                category_sub: '地铁站',
                longitude: 114.3304,
                latitude: 30.5768,
                distance_m: 356.9,
              },
            ],
            rowCount: 3,
          }
        }

        if (sql.includes("category_sub = '地铁站'")) {
          return {
            rows: [
              {
                id: 2,
                name: '小洪山地铁站A口',
                category_main: '交通设施服务',
                category_sub: '地铁站',
                longitude: 114.355,
                latitude: 30.54,
                distance_m: 1027.9,
              },
            ],
            rowCount: 1,
          }
        }

        if (sql.includes('餐饮美食')) {
          return {
            rows: [
              {
                id: 10,
                name: '武大食堂街',
                category_main: '餐饮美食',
                category_sub: '中餐厅',
                longitude: 114.364,
                latitude: 30.536,
                distance_m: 150,
              },
              {
                id: 11,
                name: '湖大美食城',
                category_main: '餐饮美食',
                category_sub: '中餐厅',
                longitude: 114.312,
                latitude: 30.581,
                distance_m: 220,
              },
            ],
            rowCount: 2,
          }
        }

        if (sql.includes('FROM pois')) {
          return {
            rows: [
              {
                id: 31,
                name: '湖北大学地铁站E口',
                category_main: '交通设施服务',
                category_sub: '地铁站',
                longitude: 114.3308,
                latitude: 30.5772,
                distance_m: 120,
              },
              {
                id: 32,
                name: '武昌鱼馆',
                category_main: '餐饮美食',
                category_sub: '中餐厅',
                longitude: 114.3310,
                latitude: 30.5776,
                distance_m: 180,
              },
              {
                id: 33,
                name: '校园便利店',
                category_main: '购物服务',
                category_sub: '便利店',
                longitude: 114.3304,
                latitude: 30.5768,
                distance_m: 260,
              },
              {
                id: 34,
                name: '咖啡实验室',
                category_main: '餐饮美食',
                category_sub: '咖啡',
                longitude: 114.3316,
                latitude: 30.5779,
                distance_m: 320,
              },
            ],
            rowCount: 4,
          }
        }

        return {
          rows: [],
          rowCount: 0,
        }
      }),
      searchCandidates: async (placeName) => {
        if (placeName === '武汉大学') {
          return [
            {
              id: 100,
              name: '武汉大学',
              lon: 114.364339,
              lat: 30.536334,
              category_main: '科教文化服务',
              category_sub: '学校',
            },
          ]
        }

        if (placeName === '湖北大学') {
          return [
            {
              id: 101,
              name: '湖北大学',
              lon: 114.33412099978432,
              lat: 30.57687000005052,
              category_main: '科教文化服务',
              category_sub: '学校',
            },
          ]
        }

        if (placeName === '光谷步行街') {
          return [
            {
              id: 200,
              name: '世界城(光谷步行街通讯数码港)',
              lon: 114.412919,
              lat: 30.507681,
              category_main: '购物服务',
              category_sub: '购物相关场所',
            },
          ]
        }

        return []
      },
      healthcheck: async () => true,
    }),
  )
  registry.register(createSpatialEncoderSkill())
  registry.register(createSpatialVectorSkill())
  registry.register(createRouteDistanceSkill())

  const shortTerm = new ShortTermMemory()
  const chat = new GeoLoomAgent({
    registry,
    version: '0.3.0-test',
    provider: createProvider(options.providerMode),
    manifestLoader: new SkillManifestLoader({
      rootDir: new URL('../../../SKILLS/', import.meta.url),
    }),
    memory: new MemoryManager({
      shortTerm,
      longTerm: new LongTermMemory({
        dataDir: new URL('../../../.tmp-tests/memory/', import.meta.url),
      }),
      profiles: new ProfileManager({
        profileDir: new URL('../../../profiles/', import.meta.url),
      }),
    }),
    sessionManager: new SessionManager({
      memory: shortTerm,
    }),
    conversationMemory: new ConversationMemory(),
  })

  return createApp({
    registry,
    version: '0.3.0-test',
    checkDatabaseHealth: async () => true,
    chat,
  })
}
