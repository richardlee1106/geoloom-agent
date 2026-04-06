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

function createMockLLMResponse(input: {
  message?: string | null
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

function buildTestApp(options: { provider?: LLMProvider } = {}) {
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
    provider: options.provider || new InMemoryLLMProvider(),
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

describe('POST /api/geo/chat', () => {
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
    expect(refined.answer).toMatch(/最近的出口是E口/)
    expect(refined.answer).toMatch(/可用站口包括E口、A口、D口/)
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
    expect(refined.answer).toMatch(/相似|片区/)

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

  it('closes the loop with unsupported answers for out-of-scope questions', async () => {
    const app = buildTestApp()
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/geo/chat',
      payload: {
        messages: [{ role: 'user', content: '这里适合开什么店？' }],
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
