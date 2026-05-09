import { describe, expect, it } from 'vitest'

import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { buildCompositeNarrativeWebFactSearcher, buildDeepSeekNarrativeWebFactSearcher, NarrativePhase3Runtime } from '../../../src/narrative/NarrativePhase3Runtime.js'
import { NarrativeWebFactCache } from '../../../src/narrative/NarrativeWebFactCache.js'
import type { SpatialFeature } from '../../../src/spatial/fetchSpatialFeatures.js'
import type { SkillDefinition } from '../../../src/skills/types.js'
import type { LLMProvider } from '../../../src/llm/types.js'

function feature(id: string, name: string, lon: number, lat: number, categoryMain = '科教文化服务', categorySub = '高等院校'): SpatialFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      name,
      category_main: categoryMain,
      category_sub: categorySub,
    },
  }
}

function shahuParkFeatures(): SpatialFeature[] {
  return [
    feature('shahu-1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
    feature('shahu-2', '沙湖公园琴园', 114.341, 30.561, '风景名胜', '公园广场'),
    feature('shahu-3', '沙湖公园歌笛湖', 114.342, 30.562, '风景名胜', '公园广场'),
  ]
}

describe('NarrativePhase3Runtime', () => {
  it('builds region candidates, LOD, path and grounded narration without LLM structure decisions', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '武汉大学', 114.34, 30.54),
        feature('2', '武汉大学图书馆', 114.341, 30.541, '科教文化服务', '图书馆'),
        feature('3', '武汉大学博物馆', 114.342, 30.542, '科教文化服务', '博物馆'),
        feature('4', '东湖风景区', 114.37, 30.56, '风景名胜', '风景名胜'),
        feature('5', '东湖绿道', 114.371, 30.561, '风景名胜', '绿道'),
        feature('6', '东湖风景区游客中心', 114.372, 30.562, '风景名胜', '游客中心'),
        feature('7', '学生宿舍', 114.343, 30.543, '科教文化服务', '宿舍'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'wuda',
          name: '武汉大学',
          fclass: 'university',
          areaSqm: 2_000_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.52, east: 114.35, north: 30.55 }),
        },
        {
          id: 'east-lake',
          name: '东湖风景区',
          fclass: 'park',
          areaSqm: 8_000_000,
          boundary: polygonFromBounds({ west: 114.35, south: 30.54, east: 114.39, north: 30.58 }),
        },
        {
          id: 'jiefang-park',
          name: '解放公园',
          fclass: 'park',
          areaSqm: 460_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.57, east: 114.35, north: 30.595 }),
        },
        {
          id: 'wuchang-riverfront',
          name: '武昌江滩公园',
          fclass: 'park',
          areaSqm: 520_000,
          boundary: polygonFromBounds({ west: 114.355, south: 30.52, east: 114.365, north: 30.56 }),
        },
        {
          id: 'han-riverfront',
          name: '汉口江滩公园',
          fclass: 'park',
          areaSqm: 620_000,
          boundary: polygonFromBounds({ west: 114.31, south: 30.53, east: 114.34, north: 30.57 }),
        },
        {
          id: 'han-street',
          name: '楚河汉街',
          fclass: 'commercial',
          areaSqm: 230_000,
          boundary: polygonFromBounds({ west: 114.335, south: 30.545, east: 114.355, north: 30.56 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'session-1',
      viewport: {
        west: 114.3,
        south: 30.5,
        east: 114.4,
        north: 30.6,
        zoom: 14,
        center: [114.35, 30.55],
      },
    })

    expect(response.session_id).toBe('session-1')
    expect(response.regions.length).toBeGreaterThanOrEqual(2)
    expect(response.story_tags?.length).toBeGreaterThan(0)
    expect(response.path.strategy).toBeTruthy()
    expect(response.path.story_tags).toEqual(response.story_tags)
    expect(response.regions.some((region) => region.story_tags?.length)).toBe(true)
    expect(response.path.nodes.length).toBeGreaterThanOrEqual(2)
    expect(response.regions.some((region) => region.role === 'primary_region')).toBe(true)
    const riverfront = response.regions.find((region) => region.display_name === '武昌江滩公园')
    const riverfrontEvidenceCount = riverfront?.pois.filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium').length
    expect(riverfront?.visual_layer.poi_heat?.points.length).toBe(riverfrontEvidenceCount)
    expect(response.regions.flatMap((region) => region.pois).some((poi) => poi.display_name.includes('宿舍'))).toBe(false)
    expect(response.path.nodes.length).toBe(response.narration.chapters.length)
    expect(response.narration.chapters.every((chapter) => {
      const region = response.regions.find((item) => item.id === chapter.region_id)
      return !region || !chapter.text.includes(`${region.display_name}。${region.display_name}`)
    })).toBe(true)
    expect(response.narration.chapters.every((chapter) => !/宿舍|广告|优惠|POI|样本|节点|权重|score|tier/.test(chapter.text))).toBe(true)
    expect(response.narration.chapters.some((chapter) => chapter.story_tags?.length)).toBe(true)
    expect(response.debug).toBeUndefined()
  })

  it('returns a structured debug snapshot only when requested', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'debug-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.debug?.recall).toMatchObject({
      features_count: 3,
      poi_count: 3,
      renderable_poi_count: 3,
      aoi_count: 1,
    })
    expect(response.debug?.candidates).toMatchObject({
      built_count: expect.any(Number),
      response_count: response.regions.length,
      fallback_used: false,
    })
    expect(response.debug?.lod).toMatchObject({ selected: response.lod })
    expect(response.debug?.path).toMatchObject({
      node_count: response.path.nodes.length,
      engine: 'seeded_lod_bbox_sampler',
      strategy: response.path.strategy,
      story_tags: response.path.story_tags,
    })
    expect(response.debug?.path).toMatchObject({ relations: expect.any(Array) })
    expect(response.debug?.story_tags).toMatchObject({
      path: response.path.story_tags,
      counts: expect.any(Object),
    })
    expect(response.debug?.facts).toMatchObject({ selected_region_count: response.narration.chapters.length })
    expect(response.debug?.performance).toMatchObject({
      timings_ms: expect.objectContaining({
        poi_query: expect.any(Number),
        aoi_query: expect.any(Number),
        total: expect.any(Number),
      }),
      limits: expect.objectContaining({
        poi_limit: expect.any(Number),
        candidate_limit: 24,
      }),
    })
  })

  it('uses exploration theme preference to change final deterministic narration focus', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })
    const common = {
      viewport: { west: 114.31, south: 30.53, east: 114.37, north: 30.59, zoom: 14, center: [114.34, 30.56] as [number, number] },
      enrichment_mode: 'off' as const,
    }
    const commerce = await runtime.build({
      ...common,
      session_id: 'theme-commerce',
      tone: 'tour',
      user_context: { time_label: '下午', weather_label: '晴', preference_label: '优先观察商业活力、消费锚点、商圈层级与餐饮休闲支撑', history_label: '测试' },
    })
    const education = await runtime.build({
      ...common,
      session_id: 'theme-education',
      tone: 'humanity',
      user_context: { time_label: '下午', weather_label: '晴', preference_label: '优先观察高校科教、校园文化、周边生活与知识社区', history_label: '测试' },
    })
    const commerceText = commerce.narration.chapters.map((chapter) => chapter.text).join('\n')
    const educationText = education.narration.chapters.map((chapter) => chapter.text).join('\n')

    expect(commerceText).toContain('商业活力')
    expect(commerceText).toContain('消费锚点')
    expect(educationText).toContain('高校科教')
    expect(educationText).toContain('校园')
    expect(commerceText).not.toEqual(educationText)
  })

  it('passes SLA budget, dynamic limit and 512-d query vector into POI recall', async () => {
    const requestInputs: Record<string, unknown>[] = []
    const queryVector = Array.from({ length: 512 }, (_, index) => index / 512)
    const runtime = new NarrativePhase3Runtime({
      embedNarrativeQuery: async () => queryVector,
      fetchSpatialFeatures: async (input) => {
        requestInputs.push(input as Record<string, unknown>)
        return [
          {
            ...feature('1', '山海关路李记鸡冠饺', 114.302, 30.602, '餐饮服务', '小吃'),
            properties: {
              ...feature('1', '山海关路李记鸡冠饺', 114.302, 30.602, '餐饮服务', '小吃').properties,
              semantic_score: 0.91,
              semantic_distance: 0.18,
              fusion_score: 0.87,
            },
          },
          feature('2', '山海关路毛氏汽水包', 114.304, 30.604, '餐饮服务', '小吃'),
        ]
      },
      fetchAoiCandidates: async () => [],
    })

    const response = await runtime.build({
      session_id: 'semantic-session',
      debug: true,
      enrichment_mode: 'off',
      viewport: {
        west: 114.29,
        south: 30.59,
        east: 114.32,
        north: 30.615,
        zoom: 16,
        center: [114.305, 30.603],
      },
    })

    const requestInput = requestInputs[0]
    expect(requestInput).toMatchObject({
      timeoutMs: expect.any(Number),
      limit: expect.any(Number),
      semanticWeight: expect.any(Number),
      semanticCandidateLimit: expect.any(Number),
    })
    expect(requestInput?.semanticQueryVector).toHaveLength(512)
    expect(Number(requestInput?.limit)).toBeLessThanOrEqual(5000)
    expect(response.debug?.performance).toMatchObject({
      semantic_recall: expect.objectContaining({
        enabled: true,
        used_query_vector: true,
        vector_dim: 512,
        top_score: 0.91,
      }),
    })
  })

  it('falls back to hard spatial recall when query embedding is not 512 dimensions', async () => {
    const requestInputs: Record<string, unknown>[] = []
    const runtime = new NarrativePhase3Runtime({
      embedNarrativeQuery: async () => [0.1, 0.2],
      fetchSpatialFeatures: async (input) => {
        requestInputs.push(input as Record<string, unknown>)
        return [feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场')]
      },
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'bad-semantic-session',
      debug: true,
      enrichment_mode: 'off',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(requestInputs[0]?.semanticQueryVector).toBeUndefined()
    expect(response.debug?.performance).toMatchObject({
      semantic_recall: expect.objectContaining({
        enabled: true,
        used_query_vector: false,
        vector_dim: 2,
      }),
    })
    expect((response.debug?.performance as { warnings?: string[] }).warnings?.some((item) => item.includes('vector_dim_2'))).toBe(true)
  })

  it('attaches optional web fact sources to narration chapters', async () => {
    const queries: string[] = []
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async (query) => {
        queries.push(query)
        return [
          {
            title: '武汉市沙湖公园管理处',
            url: 'https://ylj.wuhan.gov.cn/zwgk/zwxxgkzl_12298/jggk_12304/xsdwszjzz_12308/202001/t20200110_726388.shtml',
            snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
          },
        ]
      },
    })

    const response = await runtime.build({
      session_id: 'webfact-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].web_sources?.[0]).toMatchObject({
      title: '武汉市沙湖公园管理处',
      url: expect.stringMatching(/^https:\/\//),
      quality: 'official',
      quality_score: 0.95,
    })
    expect(queries[0]).toBe('沙湖公园 介绍')
    expect(response.narration.chapters[0].text).toContain('参考资料显示，沙湖公园是武汉市中心城区最大的综合性公园。')
    expect(response.debug?.web_facts).toMatchObject({
      queried_region_count: 1,
      source_count: 1,
    })
  })

  it('uses DeepSeek search results as narrative web fact sources', async () => {
    const skill: SkillDefinition = {
      name: 'deepseek_search',
      description: 'test',
      capabilities: ['search_web'],
      actions: {
        search_web: {
          name: 'search_web',
          description: 'test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
        },
      },
      async execute(action, payload) {
        expect(action).toBe('search_web')
        expect(payload).toMatchObject({ query: '沙湖公园 介绍', max_results: 2 })
        return {
          ok: true,
          data: {
            results: [
              {
                title: '武汉市沙湖公园介绍',
                url: 'https://example.com/shahu',
                snippet: '武汉市中心城区综合性公园。',
              },
            ],
          },
          meta: { action, audited: false },
        }
      },
    }

    const sources = await buildDeepSeekNarrativeWebFactSearcher(skill)('沙湖公园 介绍', 2)

    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      title: '武汉市沙湖公园介绍',
      url: 'https://example.com/shahu',
      snippet: '武汉市中心城区综合性公园。',
    })
  })

  it('falls back to Tavily web facts when DeepSeek search fails', async () => {
    const calls: string[] = []
    const deepSeek: SkillDefinition = {
      name: 'deepseek_search',
      description: 'test',
      capabilities: ['search_web'],
      actions: {
        search_web: {
          name: 'search_web',
          description: 'test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
        },
      },
      async execute(action) {
        calls.push(`deepseek:${action}`)
        return {
          ok: false,
          error: { code: 'deepseek_search_failed', message: 'model_not_found' },
          meta: { action, audited: false },
        }
      },
    }
    const tavily: SkillDefinition = {
      name: 'tavily_search',
      description: 'test',
      capabilities: ['search_web'],
      actions: {
        search_web: {
          name: 'search_web',
          description: 'test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
        },
      },
      async execute(action, payload) {
        calls.push(`tavily:${action}`)
        expect(payload).toMatchObject({ query: '沙湖公园 介绍', max_results: 2, search_depth: 'basic' })
        return {
          ok: true,
          data: {
            results: [
              {
                title: '沙湖公园介绍',
                url: 'https://example.com/shahu-tavily',
                content: '沙湖公园是武汉市中心城区综合性公园。',
              },
            ],
          },
          meta: { action, audited: false },
        }
      },
    }

    const searcher = buildCompositeNarrativeWebFactSearcher({ deepSeek, tavily })
    const sources = await searcher?.('沙湖公园 介绍', 2)

    expect(calls).toEqual(['deepseek:search_web', 'tavily:search_web'])
    expect(sources).toHaveLength(1)
    expect(sources?.[0]).toMatchObject({
      title: '沙湖公园介绍',
      url: 'https://example.com/shahu-tavily',
      snippet: '沙湖公园是武汉市中心城区综合性公园。',
    })
  })

  it('标题命中当前片区时也会把网页摘要注入章节文本并保留引用', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '沙湖公园介绍',
          url: 'https://example.com/shahu-intro',
          snippet: '武汉市中心城区综合性公园。',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'webfact-title-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].text).toContain('参考资料显示，武汉市中心城区综合性公园。')
    expect(response.narration.chapters[0].web_sources?.[0]?.title).toBe('沙湖公园介绍')
  })

  it('LLM 改写章节后仍会把网页事实后置合并进最终文本', async () => {
    const llmProvider: LLMProvider = {
      getStatus: () => ({ ready: true, provider: 'test', model: 'test-model' }),
      isReady: () => true,
      complete: async (request) => {
        const userPayload = JSON.parse(String(request.messages.find((message) => message.role === 'user')?.content || '{}')) as { output_contract?: { region_id_order?: string[] } }
        const regionId = userPayload.output_contract?.region_id_order?.[0] || 'shahu-park'
        return {
          assistantMessage: {
            role: 'assistant',
            content: JSON.stringify({
              chapters: [
                {
                  region_id: regionId,
                  text: '沙湖公园这一段先从湖岸空间讲起，视线落在开放绿地和城市休闲氛围上。',
                },
              ],
            }),
            toolCalls: [],
          },
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    }
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '沙湖公园介绍',
          url: 'https://example.com/shahu-intro',
          snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
        },
      ],
      llmProvider,
    })

    const response = await runtime.build({
      session_id: 'webfact-after-llm-session',
      debug: true,
      enrichment_mode: 'sync',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.debug?.llm_narrator).toMatchObject({ used: true })
    expect(response.narration.chapters[0].text).toContain('湖岸空间')
    expect(response.narration.chapters[0].text).toContain('参考资料显示，沙湖公园是武汉市中心城区最大的综合性公园。')
    expect(response.narration.chapters[0].web_sources?.[0]?.url).toBe('https://example.com/shahu-intro')
  })

  it('不会把跨城区商圈列表型网页摘要追加到当前徐东章节', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('xudong-xpm', '销品茂购物中心', 114.342, 30.59, '购物服务', '购物中心'),
        feature('xudong-oyd', '欧亚达家居徐东店', 114.343, 30.591, '购物服务', '家居'),
        feature('xudong-mix', '武汉徐东万象汇', 114.344, 30.592, '购物服务', '购物中心'),
      ],
      fetchAoiCandidates: async () => [],
      searchWebFacts: async () => [
        {
          title: '武汉主要商圈介绍',
          url: 'https://example.com/wuhan-business',
          snippet: '武汉主要商圈包括菱角湖商圈、吉庆街、昙华林、汉正街、武汉天地等。',
        },
        {
          title: '徐东商圈介绍',
          url: 'https://example.com/xudong',
          snippet: '徐东商圈以销品茂、万象汇、欧亚达等商业设施形成消费集聚。',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'xudong-webfact-session',
      debug: true,
      viewport: {
        west: 114.33,
        south: 30.575,
        east: 114.39,
        north: 30.6,
        zoom: 14,
        center: [114.36, 30.59],
      },
    })

    const chapterText = response.narration.chapters.map((chapter) => chapter.text).join(' ')
    expect(response.regions.map((region) => region.display_name)).toContain('徐东商圈')
    expect(chapterText).toContain('参考资料显示，徐东商圈以销品茂、万象汇、欧亚达等商业设施形成消费集聚。')
    expect(chapterText).not.toMatch(/菱角湖|吉庆街|昙华林|汉正街|武汉天地/)
  })

  it('点云品类不足以生成正式活力区时降级为当前视野概览', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('scenic-1', '景观节点一', 114.34, 30.58, '风景名胜', '景点'),
        feature('scenic-2', '景观节点二', 114.35, 30.581, '风景名胜', '景点'),
        feature('scenic-3', '景观节点三', 114.36, 30.582, '风景名胜', '景点'),
        feature('gov-1', '政府机构一', 114.345, 30.59, '政府机构及社会团体', '政府机关'),
        feature('gov-2', '政府机构二', 114.355, 30.591, '政府机构及社会团体', '政府机关'),
        feature('gov-3', '政府机构三', 114.365, 30.592, '政府机构及社会团体', '政府机关'),
      ],
      fetchAoiCandidates: async () => [],
    })

    const response = await runtime.build({
      session_id: 'point-cloud-block-session',
      debug: true,
      viewport: {
        west: 114.33,
        south: 30.57,
        east: 114.39,
        north: 30.61,
        zoom: 14,
        center: [114.36, 30.59],
      },
    })

    expect(response.regions.some((region) => /活力区/u.test(region.display_name))).toBe(false)
    expect(response.regions[0]?.display_name).toMatch(/概览$/u)
    expect(response.debug?.candidates).toMatchObject({ fallback_used: true })
  })

  it('sorts optional web fact sources by quality before attaching', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '沙湖公园团购优惠',
          url: 'https://example.com/deal',
          snippet: '团购优惠信息',
        },
        {
          title: '武汉市园林和林业局 沙湖公园',
          url: 'https://ylj.wuhan.gov.cn/official',
          snippet: '官方介绍',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'webfact-quality-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].web_sources?.map((source) => source.quality)).toEqual(['official', 'general'])
    expect(response.narration.chapters[0].web_sources?.[0].title).toContain('园林')
  })

  it('keeps web name candidates debug-only without changing structural regions', async () => {
    let queryCount = 0
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => {
        queryCount += 1
        return [
          {
            title: '武汉市文旅局介绍江汉路步行街与徐东商圈',
            url: 'https://wlj.wuhan.gov.cn/example',
            snippet: '江汉路步行街、徐东商圈和水塔街是武汉重要城市认知片区。',
          },
        ]
      },
    })

    const response = await runtime.build({
      session_id: 'web-name-debug-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    const debug = response.debug as {
      web_name_candidates?: {
        candidate_count?: number
        structural_effect?: string
        items?: Array<{ name?: string; confidence?: number }>
      }
    }
    expect(queryCount).toBeGreaterThanOrEqual(2)
    expect(debug.web_name_candidates?.structural_effect).toBe('debug_only')
    expect(debug.web_name_candidates?.items?.some((item) => item.name === '江汉路步行街')).toBe(true)
    expect(response.regions.some((region) => region.display_name === '江汉路步行街')).toBe(false)
  })

  it('reuses cached narrative web facts without repeating upstream search', async () => {
    let queryCount = 0
    const webFactCache = new NarrativeWebFactCache()
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async (query) => {
        if (query === '沙湖公园 介绍') queryCount += 1
        return [
          {
            title: '沙湖公园介绍',
            url: 'https://example.com/shahu-cache',
            snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
          },
        ]
      },
      webFactCache,
    })
    const request = {
      session_id: 'webfact-cache-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56] as [number, number],
      },
    }

    await runtime.build(request)
    const second = await runtime.build(request)

    expect(queryCount).toBe(1)
    expect(second.debug?.web_facts).toMatchObject({
      source_count: 1,
      items: [
        expect.objectContaining({
          cache_status: 'hit',
        }),
      ],
    })
  })

  it('returns an async initial narrative immediately and stores enriched job response later', async () => {
    let queryCount = 0
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async (query) => {
        if (query === '沙湖公园 介绍') queryCount += 1
        return [
          {
            title: '沙湖公园介绍',
            url: 'https://example.com/shahu-async',
            snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
          },
        ]
      },
    })

    const initial = await runtime.build({
      session_id: 'webfact-async-session',
      debug: true,
      enrichment_mode: 'async',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })
    const jobId = initial.enrichment?.job_id

    expect(jobId).toBeTruthy()
    expect(initial.enrichment).toMatchObject({ mode: 'async', status: 'pending', phase: 'initial' })
    expect(initial.narration.chapters[0].web_sources || []).toHaveLength(0)

    const job = await waitForEnrichmentJob(runtime, jobId!)

    expect(queryCount).toBe(1)
    expect(job.status).toBe('completed')
    expect(job.response?.session_id).toBe(initial.session_id)
    expect(job.response?.enrichment).toMatchObject({ mode: 'async', status: 'completed', phase: 'enriched', source_count: 1 })
    expect(job.response?.narration.chapters[0].web_sources?.[0]?.url).toBe('https://example.com/shahu-async')
  })

  it('未配置网页事实搜索器时异步补强会显式失败', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })

    const initial = await runtime.build({
      session_id: 'webfact-missing-searcher-session',
      debug: true,
      enrichment_mode: 'async',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })
    const jobId = initial.enrichment?.job_id

    expect(jobId).toBeTruthy()
    expect(initial.enrichment).toMatchObject({ mode: 'async', status: 'pending', phase: 'initial' })

    const job = await waitForEnrichmentJob(runtime, jobId!)

    expect(job.status).toBe('failed')
    expect(job.summary).toMatchObject({
      mode: 'async',
      status: 'failed',
      phase: 'enriched',
      source_count: 0,
    })
    expect(job.summary.error).toContain('web_fact_searcher_unavailable')
    expect(job.response).toBeUndefined()
  })

  it('不会因为非布尔 debug 输入暴露调试快照', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'debug-string-session',
      debug: 'true' as unknown as boolean,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.debug).toBeUndefined()
  })

  it('不会把广告型网页摘要注入最终章节文本', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => shahuParkFeatures(),
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '沙湖公园团购优惠',
          url: 'https://example.com/shahu-ad',
          snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'webfact-ad-session',
      debug: true,
      enrichment_mode: 'sync',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].web_sources?.[0]?.url).toBe('https://example.com/shahu-ad')
    expect(response.narration.chapters[0].text).not.toContain('参考资料显示')
  })

  it('默认会为所有解说章节尝试网页事实补强', async () => {
    const queries: string[] = []
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
        feature('2', '湖北大学图书馆', 114.345, 30.59, '科教文化服务', '图书馆'),
        feature('3', '徐东销品茂', 114.358, 30.592, '购物服务', '购物中心'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
        {
          id: 'hubei-university',
          name: '湖北大学',
          fclass: 'university',
          areaSqm: 1_000_000,
          boundary: polygonFromBounds({ west: 114.335, south: 30.58, east: 114.36, north: 30.605 }),
        },
        {
          id: 'xudong-mall',
          name: '徐东销品茂',
          fclass: 'mall',
          areaSqm: 90_000,
          boundary: polygonFromBounds({ west: 114.35, south: 30.585, east: 114.37, north: 30.6 }),
        },
      ],
      searchWebFacts: async (query) => {
        queries.push(query)
        return [
          {
            title: `${query} 来源`,
            url: `https://example.com/${queries.length}`,
            snippet: `${query} 的网页介绍。`,
          },
        ]
      },
    })

    const response = await runtime.build({
      session_id: 'webfact-all-regions-session',
      debug: true,
      enrichment_mode: 'sync',
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.39,
        north: 30.61,
        zoom: 13,
        center: [114.35, 30.58],
      },
    })

    const webFactDebug = response.debug?.web_facts as { items?: Array<{ query: string }> } | undefined
    const chapterQueries = webFactDebug?.items?.map((item) => item.query) || []
    expect(chapterQueries).toHaveLength(response.narration.chapters.length)
    expect(queries).toEqual(expect.arrayContaining(chapterQueries))
    expect(response.debug?.web_facts).toMatchObject({
      queried_region_count: response.narration.chapters.length,
      source_count: response.narration.chapters.length,
    })
    expect(response.narration.chapters.every((chapter) => (chapter.web_sources || []).length > 0)).toBe(true)
  })
})

async function waitForEnrichmentJob(runtime: NarrativePhase3Runtime, jobId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = runtime.getEnrichmentJob(jobId)
    if (job?.status === 'completed' || job?.status === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('enrichment job did not settle')
}
