import { describe, expect, it, vi } from 'vitest'

import { GeoLoomAgent } from '../../../src/agent/GeoLoomAgent.js'
import { SessionManager } from '../../../src/agent/SessionManager.js'
import { ConversationMemory } from '../../../src/agent/ConversationMemory.js'
import { createApp } from '../../../src/app.js'
import type { LLMProvider } from '../../../src/llm/types.js'
import { InMemoryLLMProvider } from '../../../src/llm/InMemoryLLMProvider.js'
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
import type { PythonBridge } from '../../../src/integration/pythonBridge.js'
import type { FaissIndex } from '../../../src/integration/faissIndex.js'

function createMockLLMResponse(input: {
  message?: string | null
  contentBlocks?: Array<Record<string, unknown>>
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
  finishReason: 'tool_calls' | 'stop'
}) {
  const toolCalls = input.toolCalls || []

  return {
    assistantMessage: {
      role: 'assistant' as const,
      content: input.message ?? null,
      toolCalls,
      contentBlocks: input.contentBlocks || [],
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

function parseSSE(raw: string) {
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

function buildTestApp(options: {
  provider?: LLMProvider
  memory?: MemoryManager
  encoderBridge?: PythonBridge
  vectorIndex?: FaissIndex
  searchCandidates?: (placeName: string, variants: string[]) => Promise<Array<{
    id?: string | number
    name: string
    lon?: number
    lat?: number
    category_main?: string
    category_sub?: string
    category_big?: string
    category_mid?: string
    category_small?: string
  }>>
} = {}) {
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
          if (sql.includes("category_sub = '咖啡'")) {
            return {
              rows: [
                { competition_key: '咖啡', poi_count: 4, nearest_distance_m: 68, avg_distance_m: 214 },
              ],
              rowCount: 1,
            }
          }

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
                latitude: 30.540,
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
      searchCandidates: options.searchCandidates || (async (placeName) => {
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
      }),
      healthcheck: async () => true,
    }),
  )
  registry.register(createSpatialEncoderSkill({
    bridge: options.encoderBridge,
  }))
  registry.register(createSpatialVectorSkill({
    index: options.vectorIndex,
  }))
  registry.register(createRouteDistanceSkill())

  const shortTerm = new ShortTermMemory()
  const memory = options.memory || new MemoryManager({
    shortTerm,
    longTerm: new LongTermMemory({
      dataDir: new URL('../../../.tmp-tests/memory/', import.meta.url),
    }),
    profiles: new ProfileManager({
      profileDir: new URL('../../../profiles/', import.meta.url),
    }),
  })

  const chat = new GeoLoomAgent({
    registry,
    version: '0.3.0-test',
    provider: options.provider || new InMemoryLLMProvider(),
    manifestLoader: new SkillManifestLoader({
      rootDir: new URL('../../../SKILLS/', import.meta.url),
    }),
    memory,
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

describe('POST /api/geo/chat', () => {
  it('streams reasoning chunks when the provider returns thinking blocks during tool planning', async () => {
    const app = buildTestApp({
      provider: {
        isReady: () => true,
        getStatus: () => ({
          ready: true,
          provider: 'mock-thinking-provider',
          model: 'mock-thinking-v1',
        }),
        complete: async ({ messages }) => {
          if (!hasToolResult(messages, 'postgis', (payload) => Boolean(payload.anchor))) {
            return createMockLLMResponse({
              message: null,
              contentBlocks: [
                {
                  type: 'thinking',
                  thinking: '先定位武汉大学，再决定应该调哪一个空间检索模板。',
                },
              ],
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'tool_reasoning_resolve_anchor',
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
              contentBlocks: [
                {
                  type: 'thinking',
                  thinking: '锚点已经锁定，继续抓取附近咖啡样本，然后再回写结论。',
                },
              ],
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'tool_reasoning_execute_sql',
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
            message: '武汉大学附近可见 luckin coffee。',
            contentBlocks: [
              {
                type: 'text',
                text: '武汉大学附近可见 luckin coffee。',
              },
            ],
            finishReason: 'stop',
            toolCalls: [],
          })
        },
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_reasoning_blocks_001' },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const reasoningEvents = events.filter((item) => item.event === 'reasoning')
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(reasoningEvents.length).toBeGreaterThan(0)
    expect(reasoningEvents[0]?.data.content).toMatch(/定位武汉大学|锚点已经锁定/)
    expect(refined.answer).toMatch(/luckin coffee/)

    await app.close()
  })

  it('streams a nearby poi answer for 武汉大学附近有哪些咖啡店', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/event-stream/)

    const events = parseSSE(response.body)
    expect(events.map((item) => item.event)).toContain('intent_preview')
    expect(events.map((item) => item.event)).toContain('pois')
    expect(events.map((item) => item.event)).toContain('refined_result')
    expect(events.at(-1)?.event).toBe('done')

    const refined = events.find((item) => item.event === 'refined_result')?.data
    expect(refined.answer).toMatch(/武汉大学/)
    expect(refined.answer).toMatch(/luckin coffee/)
    expect(refined.results.stats.query_type).toBe('nearby_poi')
    expect(refined.results.evidence_view.type).toBe('poi_list')
    expect(refined.tool_calls.length).toBeGreaterThan(0)

    await app.close()
  })

  it('accepts legacy message payloads without downgrading supported queries to unsupported', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        message: '武汉大学附近有哪些咖啡店？',
        options: { requestId: 'req_chat_legacy_message_001' },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('nearby_poi')
    expect(refined.results.evidence_view.type).toBe('poi_list')
    expect(refined.answer).toMatch(/武汉大学/)
    expect(refined.answer).toMatch(/luckin coffee/)
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('updates health metrics after a completed chat request', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_metrics_001' },
      },
    })

    expect(response.statusCode).toBe(200)

    const health = await app.inject({
      method: 'GET',
      url: '/api/geo/health',
    })

    expect(health.statusCode).toBe(200)
    const payload = health.json()

    expect(payload.metrics.requests_total).toBe(1)
    expect(payload.metrics.latency.count).toBe(1)
    expect(payload.metrics.latency.p50_ms).toBeGreaterThanOrEqual(0)
    expect(payload.metrics.latency.p95_ms).toBeGreaterThanOrEqual(payload.metrics.latency.p50_ms)
    expect(payload.metrics.sql.validation_attempts).toBeGreaterThan(0)
    expect(payload.metrics.sql_valid_rate).toBeGreaterThan(0)
    expect(payload.metrics.evidence_grounded_answer_rate).toBeGreaterThan(0)

    await app.close()
  })

  it('streams a nearest station answer for 湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近' }],
        options: { requestId: 'req_chat_002' },
      },
    })

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/湖北大学地铁站/)
    expect(refined.answer).toMatch(/最近的出口是A口|最近的出口是E口/)
    expect(refined.answer).toMatch(/可用站口包括A口、E口、D口|可用站口包括E口、A口、D口/)
    expect(refined.results.stats.query_type).toBe('nearest_station')
    expect(refined.results.evidence_view.type).toBe('transport')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('keeps school anchors in the correct campus cluster when an exact-name poi is spatially wrong', async () => {
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
          if (sql.includes("category_sub = '地铁站'") && sql.includes('114.33412099978432') && sql.includes('30.57687000005052')) {
            return {
              rows: [
                {
                  id: 3001,
                  name: '湖北大学地铁站E口',
                  category_main: '交通设施服务',
                  category_sub: '地铁站',
                  longitude: 114.3308,
                  latitude: 30.5772,
                  distance_m: 268.4,
                },
              ],
              rowCount: 1,
            }
          }

          if (sql.includes("category_sub = '地铁站'") && sql.includes('114.26762399994766') && sql.includes('30.58676000017391')) {
            return {
              rows: [
                {
                  id: 3002,
                  name: '青年路地铁站D口',
                  category_main: '交通设施服务',
                  category_sub: '地铁站',
                  longitude: 114.2649,
                  latitude: 30.5862,
                  distance_m: 336.4,
                },
              ],
              rowCount: 1,
            }
          }

          return {
            rows: [],
            rowCount: 0,
          }
        }),
        searchCandidates: async (placeName) => {
          if (placeName === '湖北大学') {
            return [
              {
                id: 319490,
                name: '湖北大学',
                lon: 114.26762399994766,
                lat: 30.58676000017391,
                category_main: '科教文化服务',
                category_sub: '科教文化场所',
              },
              {
                id: 319491,
                name: '湖北大学(武昌校区)',
                lon: 114.33412099978432,
                lat: 30.57687000005052,
                category_main: '科教文化服务',
                category_sub: '学校',
              },
              {
                id: 319492,
                name: '湖北大学-教4',
                lon: 114.333922,
                lat: 30.577112,
                category_main: '科教文化服务',
                category_sub: '学校',
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
      provider: new InMemoryLLMProvider(),
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

    const app = createApp({
      registry,
      version: '0.3.0-test',
      checkDatabaseHealth: async () => true,
      chat,
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '湖北大学最近的地铁站，站口也列出来，并说明哪个出口最近' }],
        options: { requestId: 'req_chat_anchor_regression_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.anchor_name).toBe('湖北大学(武昌校区)')
    expect(refined.results.stats.anchor_lon).toBeCloseTo(114.33412099978432)
    expect(refined.results.stats.anchor_lat).toBeCloseTo(30.57687000005052)
    expect(refined.answer).toMatch(/湖北大学地铁站E口/)
    expect(refined.answer).not.toMatch(/青年路/)
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('recovers nearest station queries when the provider skips postgis anchor resolution', async () => {
    const app = buildTestApp({
      provider: {
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
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学最近的地铁站是什么？' }],
        options: { requestId: 'req_chat_nearest_station_recover_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/地铁站/)
    expect(refined.answer).toMatch(/小洪山/)
    expect(refined.results.stats.query_type).toBe('nearest_station')
    expect(refined.results.evidence_view.type).toBe('transport')
    expect(refined.results.evidence_view.items.length).toBeGreaterThan(0)

    await app.close()
  })

  it('returns semantic candidate evidence for similar-region questions', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '和武汉大学周边气质相似的片区有哪些？' }],
        options: { requestId: 'req_chat_005' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('similar_regions')
    expect(refined.results.evidence_view.type).toBe('semantic_candidate')
    expect(refined.results.stats.semantic_evidence_level).toBe('degraded')
    expect(refined.results.evidence_view.semanticEvidence.level).toBe('degraded')
    expect(refined.answer).toMatch(/相似|片区/)

    await app.close()
  })

  it('does not let degraded semantic vector evidence become the main basis for area-opportunity conclusions', async () => {
    const app = buildTestApp({
      provider: {
        isReady: () => true,
        getStatus: () => ({
          ready: true,
          provider: 'mock-semantic-only',
          model: 'mock-semantic-only-v1',
        }),
        complete: async ({ messages }) => {
          const hasSemanticRegions = hasToolResult(messages, 'spatial_vector', (payload) => Array.isArray(payload.regions))

          if (!hasSemanticRegions) {
            return createMockLLMResponse({
              message: null,
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'tool_only_semantic_regions',
                  name: 'spatial_vector',
                  arguments: {
                    action: 'search_similar_regions',
                    payload: {
                      text: '当前区域适合开什么店',
                      top_k: 3,
                    },
                  },
                },
              ],
            })
          }

          return createMockLLMResponse({
            message: '这是来自大模型的最终结论：最值得优先开的就是咖啡馆，不需要再看结构证据。',
            finishReason: 'stop',
            toolCalls: [],
          })
        },
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '如果要在当前区域开店，哪些业态更值得优先考虑？请结合周边供给、需求和竞争关系说明理由。' }],
        options: {
          requestId: 'req_chat_area_semantic_guard_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.stats.semantic_evidence_level).toBe('degraded')
    expect(refined.results.evidence_view.semanticEvidence.level).toBe('degraded')
    expect(refined.answer).not.toContain('这是来自大模型的最终结论')
    expect(refined.answer).not.toContain('不需要再看结构证据')
    expect(refined.results.evidence_view.type).toBe('area_overview')

    await app.close()
  })

  it('returns comparison evidence for compare queries', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '比较武汉大学和湖北大学附近的餐饮活跃度' }],
        options: { requestId: 'req_chat_006' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('compare_places')
    expect(refined.results.evidence_view.type).toBe('comparison')
    expect(refined.answer).toMatch(/武汉大学|湖北大学/)

    await app.close()
  })

  it('returns comparison evidence for multi-region compare queries without explicit place anchors', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '比较选区1和选区2的餐饮业态分布，并说明差异。' }],
        options: {
          requestId: 'req_chat_regions_compare_001',
          regions: [
            {
              id: 'region-1',
              name: '选区1',
              center: [114.331, 30.577],
              boundaryWKT: 'POLYGON((114.329 30.575, 114.333 30.575, 114.333 30.579, 114.329 30.579, 114.329 30.575))',
            },
            {
              id: 'region-2',
              name: '选区2',
              center: [114.338, 30.583],
              boundaryWKT: 'POLYGON((114.336 30.581, 114.34 30.581, 114.34 30.585, 114.336 30.585, 114.336 30.581))',
            },
          ],
          spatialContext: {
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(events.map((item) => item.event)).not.toContain('error')
    expect(refined.results.stats.query_type).toBe('compare_places')
    expect(refined.results.evidence_view.type).toBe('comparison')
    expect(refined.results.evidence_view.pairs.length).toBeGreaterThanOrEqual(2)
    expect(refined.results.evidence_view.pairs[0].label).toBe('选区1')
    expect(refined.results.evidence_view.pairs[1].label).toBe('选区2')

    await app.close()
  })

  it('prefers the grounded markdown answer over an ungrounded provider summary for area insight questions', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-area-insight',
        target: 'https://example.test/v1',
      }),
      complete: vi.fn(async ({ messages }) => {
        if (!hasToolResult(messages, 'postgis', (payload) => Boolean(payload.anchor))) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_area_anchor',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '当前区域',
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
                id: 'tool_area_sql',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: {
                    template: 'area_overview',
                    limit: 80,
                  },
                },
              },
            ],
          })
        }

        return createMockLLMResponse({
          message: '当前区域以餐饮和日常零售为主，热点靠近地铁口，机会更偏向补足停留型与服务型配套。',
          finishReason: 'stop',
        })
      }),
    } satisfies LLMProvider

    const app = buildTestApp({ provider })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。' }],
        options: {
          requestId: 'req_chat_area_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).not.toBe('当前区域以餐饮和日常零售为主，热点靠近地铁口，机会更偏向补足停留型与服务型配套。')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(refined.results.evidence_view.areaSubject).toBeTruthy()
    expect(JSON.stringify(refined.results.evidence_view.areaSubject)).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/^## /m)
    expect(refined.answer).toMatch(/## 区域主语/)
    expect(refined.answer).toMatch(/## 关键特征/)
    expect(refined.answer).toMatch(/## 热点与结构/)
    expect(refined.answer).toMatch(/## 机会与风险/)
    expect(refined.answer).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/湖北大学地铁站E口|武昌鱼馆|校园便利店/)
    expect(refined.answer).not.toMatch(/范围内 \d+ 个|高密点位/)

    await app.close()
  })

  it('does not silently fall back to a deterministic area-insight template when the provider gathered no evidence', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-area-insight-no-tools',
        target: 'https://example.test/v1',
      }),
      complete: vi.fn(async () => {
          return createMockLLMResponse({
            message: '这是一个没有拿任何证据就直接给出的泛泛结论。',
            finishReason: 'stop',
          })
      }),
    } satisfies LLMProvider

    const app = buildTestApp({ provider })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。' }],
        options: {
          requestId: 'req_chat_area_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).not.toBe('这是一个没有拿任何证据就直接给出的泛泛结论。')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(refined.results.evidence_view.areaSubject).toBeFalsy()
    expect(refined.results.stats.tool_call_count).toBe(0)
    expect(refined.results.stats.answer_source).toBe('insufficient_evidence')
    expect(refined.results.stats.task_mode).toBe('analysis')
    expect(refined.answer).toMatch(/证据不足|不下高置信结论|没有拿到足够/)
    expect(refined.answer).not.toMatch(/^## /m)

    await app.close()
  })

  it('carries optional AOI and landuse evidence into the final area_overview view', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-area-context',
        target: 'https://example.test/v1',
      }),
      complete: vi.fn(async ({ messages }) => {
        if (!hasToolResult(messages, 'postgis', (payload) => Boolean(payload.anchor))) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_area_anchor_context',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '当前区域',
                    role: 'primary',
                  },
                },
              },
            ],
          })
        }

        const hasAoi = hasToolResult(messages, 'postgis', (payload) => {
          const rows = Array.isArray(payload.rows) ? payload.rows : []
          return rows.some((row) => row && typeof row === 'object' && 'fclass' in row)
        })
        const hasLanduse = hasToolResult(messages, 'postgis', (payload) => {
          const rows = Array.isArray(payload.rows) ? payload.rows : []
          return rows.some((row) => row && typeof row === 'object' && 'land_type' in row)
        })

        if (!hasAoi || !hasLanduse) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_area_aoi_context',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: {
                    template: 'area_aoi_context',
                    limit: 5,
                  },
                },
              },
              {
                id: 'tool_area_landuse_context',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: {
                    template: 'area_landuse_context',
                    limit: 6,
                  },
                },
              },
            ],
          })
        }

        return createMockLLMResponse({
          message: '当前区域兼具居住与商业混合特征，可结合 AOI 和用地结构进一步解释片区语义。',
          finishReason: 'stop',
        })
      }),
    } satisfies LLMProvider

    const app = buildTestApp({ provider })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，并顺手解释一下它更像居住片区、商业片区，还是混合片区。' }],
        options: {
          requestId: 'req_chat_area_context_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(refined.results.evidence_view.aoiContext[0].name).toBe('湖北大学生活区')
    expect(refined.results.evidence_view.aoiContext[0].fclass).toBe('residential')
    expect(refined.results.evidence_view.landuseContext[0].landType).toBe('residential')
    expect(refined.results.evidence_view.landuseContext[0].totalAreaSqm).toBe(86000)

    await app.close()
  })

  it('returns current-area overview evidence instead of unsupported for map-view insight prompts', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。' }],
        options: {
          requestId: 'req_chat_area_overview_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.stats.anchor_name).toBe('当前区域')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(refined.results.evidence_view.areaSubject).toBeTruthy()
    expect(JSON.stringify(refined.results.evidence_view.areaSubject)).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/^## /m)
    expect(refined.answer).toMatch(/## 区域主语/)
    expect(refined.answer).toMatch(/## 关键特征/)
    expect(refined.answer).toMatch(/## 热点与结构/)
    expect(refined.answer).toMatch(/## 机会与风险/)
    expect(refined.answer).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/湖北大学地铁站E口|武昌鱼馆|校园便利店/)
    expect(refined.answer).not.toMatch(/范围内 \d+ 个|高密点位/)
    expect(refined.answer).not.toMatch(/热点网格1/)

    await app.close()
  })

  it('accepts 解读一下这片区域 through the LLM intent-understanding path instead of returning unsupported', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '解读一下这片区域' }],
        options: {
          requestId: 'req_chat_area_overview_interpret_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const intentPreview = events.find((item) => item.event === 'intent_preview')?.data
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(events.map((item) => item.event)).not.toContain('error')
    expect(intentPreview?.parserModel).toBe('agent-intent-understanding')
    expect(intentPreview?.parserProvider).toBe('llm')
    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.stats.anchor_name).toBe('当前区域')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(refined.answer).toMatch(/湖北大学/)
    expect(refined.answer).not.toMatch(/当前 V4 已支持|只支持/)

    await app.close()
  })

  it('encodes current-area snapshots through spatial_encoder so area insight can see region features instead of only counts', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请真正读懂当前区域的空间特征，不要只报数量。' }],
        options: {
          requestId: 'req_chat_area_snapshot_encoder_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.tool_calls.some((call: { skill?: string, action?: string }) => call.skill === 'spatial_encoder' && call.action === 'encode_region_snapshot')).toBe(true)
    expect(refined.results.evidence_view.regionFeatureSummary).toMatch(/校园|混合|热点|竞争/)
    expect(refined.results.evidence_view.regionFeatures.length).toBeGreaterThan(0)
    expect(refined.answer).toMatch(/校园主导|居住商业混合|单核热点|餐饮竞争偏密/)
    expect(refined.answer).not.toMatch(/范围内 \d+ 个|高密点位/)

    await app.close()
  })

  it('encodes representative poi profiles so area insight can explain which samples support the area judgement', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请读懂当前区域，并说明哪些代表点在支撑你的判断。' }],
        options: {
          requestId: 'req_chat_area_poi_profile_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.tool_calls.some((call: { skill?: string, action?: string }) => call.skill === 'spatial_encoder' && call.action === 'encode_poi_profile')).toBe(true)
    expect(refined.results.evidence_view.representativePoiProfiles.length).toBeGreaterThan(0)
    expect(JSON.stringify(refined.results.evidence_view.representativePoiProfiles)).toMatch(/交通接驳点|日常配套支点|校园高频消费点/)
    expect(refined.answer).toMatch(/交通接驳点|日常配套支点|校园高频消费点/)
    expect(refined.answer).toMatch(/湖北大学地铁站E口|武昌鱼馆|校园便利店/)

    await app.close()
  })

  it('pulls AOI and landuse enhancement evidence for current-area summary prompts in the default agent loop', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。' }],
        options: {
          requestId: 'req_chat_area_overview_context_default_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.evidence_view.aoiContext[0].name).toBe('湖北大学生活区')
    expect(refined.results.evidence_view.landuseContext[0].landType).toBe('residential')
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_aoi_context')).toBe(true)
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_landuse_context')).toBe(true)

    await app.close()
  })

  it('answers current-area store-opportunity prompts with a grounded markdown opportunity analysis', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '如果要在当前区域开店，哪些业态更值得优先考虑？请结合周边供给、需求和竞争关系说明理由。' }],
        options: {
          requestId: 'req_chat_area_opportunity_default_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.evidence_view.areaSubject).toBeTruthy()
    expect(JSON.stringify(refined.results.evidence_view.areaSubject)).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/^## /m)
    expect(refined.answer).toMatch(/## 区域主语/)
    expect(refined.answer).toMatch(/## 关键特征/)
    expect(refined.answer).toMatch(/## 热点与结构/)
    expect(refined.answer).toMatch(/## 机会与风险/)
    expect(refined.answer).toMatch(/从经营视角看|优先方向/)
    expect(refined.answer).toMatch(/供给|供给偏薄/)
    expect(refined.answer).toMatch(/竞争|警惕/)
    expect(refined.answer).toMatch(/湖北大学/)
    expect(refined.answer).toMatch(/湖北大学地铁站E口|武昌鱼馆|校园便利店/)
    expect(refined.answer).not.toMatch(/范围内 \d+ 个|高密点位/)
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_aoi_context')).toBe(true)
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_landuse_context')).toBe(true)

    await app.close()
  })

  it('does not emit an error for 这里附近 business-mix quick actions when map-view context is available', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。' }],
        options: {
          requestId: 'req_chat_area_overview_here_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(events.map((item) => item.event)).not.toContain('error')
    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.stats.anchor_name).toBe('当前区域')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('does not emit an error for current-area compare quick actions without explicit place anchors', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请把当前区域和周边热点片区做对比，说明它们在人流、业态结构和商业机会上的差异，并给出建议。' }],
        options: {
          requestId: 'req_chat_area_compare_hotspots_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(events.map((item) => item.event)).not.toContain('error')
    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.stats.anchor_name).toBe('当前区域')
    expect(refined.results.evidence_view.type).toBe('area_overview')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('returns clarification instead of 500 when anchor cannot be resolved', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '火星大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_003' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/没有定位到|请告诉我/)
    expect(events.map((item) => item.event)).not.toContain('error')

    await app.close()
  })

  it('falls back to the deterministic visible loop when the configured provider is unavailable', async () => {
    const app = buildTestApp({
      provider: {
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
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_fallback_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const trace = events.find((item) => item.event === 'trace')?.data
    const job = events.find((item) => item.event === 'job')?.data
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(trace.provider_ready).toBe(false)
    expect(job.mode).toBe('deterministic_visible_loop')
    expect(refined.answer).toMatch(/武汉大学/)
    expect(refined.results.stats.provider_ready).toBe(false)
    expect(refined.tool_calls.length).toBeGreaterThan(0)

    await app.close()
  })

  it('still pulls AOI and landuse enhancement evidence for area_overview when the provider is unavailable', async () => {
    const app = buildTestApp({
      provider: {
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
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '请快速读懂当前区域，并判断它更像居住区、商业区还是混合片区。' }],
        options: {
          requestId: 'req_chat_area_fallback_context_001',
          spatialContext: {
            viewport: [114.30, 30.54, 114.38, 30.60],
            mapZoom: 15,
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.results.stats.provider_ready).toBe(false)
    expect(refined.results.stats.query_type).toBe('area_overview')
    expect(refined.results.evidence_view.aoiContext[0].name).toBe('湖北大学生活区')
    expect(refined.results.evidence_view.landuseContext[0].landType).toBe('residential')
    expect(refined.answer).toMatch(/居住/)
    expect(refined.answer).toMatch(/商业/)
    expect(refined.answer).toMatch(/混合/)
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_aoi_context')).toBe(true)
    expect(refined.tool_calls.some((call: { payload?: { template?: string } }) => call.payload?.template === 'area_landuse_context')).toBe(true)

    await app.close()
  })

  it('prefers the provider final answer text when the LLM returns a polished conclusion', async () => {
    const app = buildTestApp({
      provider: {
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
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_polished_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toContain('这是来自大模型的最终结论')
    expect(refined.answer).toContain('luckin coffee')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('uses the requested category for compare_places instead of forcing food queries', async () => {
    const app = buildTestApp({
      provider: {
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
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '比较武汉大学和湖北大学附近的地铁分布' }],
        options: { requestId: 'req_chat_compare_metro_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data
    const pairs = refined.results.evidence_view.pairs

    expect(refined.results.stats.query_type).toBe('compare_places')
    expect(pairs).toHaveLength(2)
    expect(pairs[0].items[0].categorySub).toBe('地铁站')
    expect(pairs[1].items[0].categorySub).toBe('地铁站')

    await app.close()
  })

  it('degrades gracefully when the provider throws instead of leaving the SSE flow with only an error event', async () => {
    const app = buildTestApp({
      provider: {
        isReady: () => true,
        getStatus: () => ({
          ready: true,
          provider: 'mock-throwing',
          model: 'mock-throwing-v1',
        }),
        complete: async () => {
          throw new Error('upstream llm timeout')
        },
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_provider_throw_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(events.map((item) => item.event)).toContain('refined_result')
    expect(events.at(-1)?.event).toBe('done')
    expect(refined.answer).toMatch(/武汉大学|咖啡/)

    await app.close()
  })

  it('emits an SSE error when a tool throws during tool_run instead of silently degrading', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-tool-throw',
        model: 'mock-tool-throw-v1',
      }),
      complete: async ({ messages }: { messages: Array<{ role: string }> }) => {
        const hasToolResult = messages.some((message) => message.role === 'tool')
        if (!hasToolResult) {
          return createMockLLMResponse({
            message: null,
            finishReason: 'tool_calls',
            toolCalls: [
              {
                id: 'tool_resolve_anchor_throwing',
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

        return createMockLLMResponse({
          message: '请基于已有证据给出确定性摘要。',
          finishReason: 'stop',
          toolCalls: [],
        })
      },
    } satisfies LLMProvider

    const app = buildTestApp({
      provider,
      searchCandidates: async () => {
        throw new Error('searchCandidates boom')
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_tool_throw_001' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const errorEvent = events.find((item) => item.event === 'error')?.data

    expect(events.map((item) => item.event)).toContain('error')
    expect(events.map((item) => item.event)).not.toContain('refined_result')
    expect(errorEvent?.message).toMatch(/searchCandidates boom/)
    expect(events.at(-1)?.event).toBe('error')

    await app.close()
  })

  it('does not append a late SSE error after refined_result when memory persistence fails', async () => {
    const shortTerm = new ShortTermMemory()
    const memory = new MemoryManager({
      shortTerm,
      longTerm: new LongTermMemory({
        dataDir: new URL('../../../.tmp-tests/memory/', import.meta.url),
      }),
      profiles: new ProfileManager({
        profileDir: new URL('../../../profiles/', import.meta.url),
      }),
    })
    vi.spyOn(memory, 'recordTurn').mockRejectedValue(new Error('memory write failed'))

    const app = buildTestApp({ memory })
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
        options: { requestId: 'req_chat_memory_failure_001' },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/武汉大学/)
    expect(events.map((item) => item.event)).toContain('refined_result')
    expect(events.map((item) => item.event)).not.toContain('error')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('closes the loop with unsupported answers for out-of-scope questions', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '帮我写一首关于春天的诗。' }],
        options: { requestId: 'req_chat_004' },
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/当前 V4|只支持/)
    expect(refined.results.stats.query_type).toBe('unsupported')
    expect(events.at(-1)?.event).toBe('done')

    await app.close()
  })

  it('streams a nearby poi answer for 我附近有哪些咖啡店 when userLocation is provided', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '我附近有哪些咖啡店？' }],
        options: {
          requestId: 'req_chat_user_location_001',
          spatialContext: {
            userLocation: {
              lon: 114.3655,
              lat: 30.5431,
              accuracyM: 18,
              source: 'browser_geolocation',
              capturedAt: '2026-04-06T10:00:00.000Z',
            },
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/当前位置/)
    expect(refined.results.stats.query_type).toBe('nearby_poi')
    expect(refined.results.evidence_view.anchor.resolvedPlaceName).toBe('当前位置')
    expect(refined.results.evidence_view.type).toBe('poi_list')

    await app.close()
  })

  it('streams a nearest-station answer for 离我最近的地铁站 when userLocation is provided', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '离我最近的地铁站是什么？' }],
        options: {
          requestId: 'req_chat_user_location_002',
          spatialContext: {
            userLocation: {
              lon: 114.3655,
              lat: 30.5431,
              accuracyM: 18,
              source: 'browser_geolocation',
              capturedAt: '2026-04-06T10:00:00.000Z',
            },
          },
        },
      },
    })

    expect(response.statusCode).toBe(200)

    const events = parseSSE(response.body)
    const refined = events.find((item) => item.event === 'refined_result')?.data

    expect(refined.answer).toMatch(/当前位置/)
    expect(refined.results.stats.query_type).toBe('nearest_station')
    expect(refined.results.evidence_view.anchor.resolvedPlaceName).toBe('当前位置')
    expect(refined.results.evidence_view.type).toBe('transport')

    await app.close()
  })
})
