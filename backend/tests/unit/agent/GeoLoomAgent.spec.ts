import { describe, expect, it, vi } from 'vitest'

import { GeoLoomAgent } from '../../../src/agent/GeoLoomAgent.js'
import type { EvidenceView } from '../../../src/chat/types.js'
import type { LLMCompletionRequest, LLMProvider, LLMResponse } from '../../../src/llm/types.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

function buildAreaOverviewEvidenceView(): EvidenceView {
  return {
    type: 'area_overview',
    anchor: {
      placeName: '当前区域',
      displayName: '当前区域',
      resolvedPlaceName: '当前区域',
    },
    items: [
      { name: '校园便利店' },
    ],
    meta: {},
    areaSubject: {
      title: '武汉大学校园片区',
      anchorName: '武汉大学',
      typeHint: '校园片区',
      confidence: 'high',
    },
    representativeSamples: [
      { name: '校园便利店' },
    ],
    hotspots: [
      { label: '主入口热点', poiCount: 8 },
    ],
    regionFeatures: [
      { key: 'campus', label: '校园主导', score: 0.96 },
      { key: 'multi_core', label: '多核活力', score: 0.82 },
    ],
    areaProfile: {
      totalCount: 24,
      dominantCategories: [
        { label: '餐饮', count: 10, share: 0.42 },
        { label: '生活服务', count: 8, share: 0.33 },
      ],
      lowSignalRatio: 0.08,
      ringFootfall: [],
    },
  }
}

function createJsonProvider(payload: Record<string, unknown>): LLMProvider {
  return {
    isReady: () => true,
    getStatus: () => ({
      ready: true,
      model: 'test-intent-model',
      provider: 'test-provider',
    }),
    complete: async () => ({
      assistantMessage: {
        role: 'assistant',
        content: JSON.stringify(payload),
        toolCalls: [],
      },
      toolCalls: [],
      finishReason: 'stop',
    }),
  }
}

describe('GeoLoomAgent metro nearby fallback SQL', () => {
  it('normalizes LLM-produced resolve_anchor payload aliases into the primary anchor contract', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const normalized = (agent as any).normalizeToolCall({
      id: 'tool_resolve_alias',
      name: 'postgis',
      arguments: {
        action: 'resolve_anchor',
        payload: {
          anchor: '武汉大学',
          role: 'anchor',
        },
      },
    })

    expect(normalized.arguments.payload).toMatchObject({
      place_name: '武汉大学',
      role: 'primary',
    })
  })

  it('normalizes LLM-produced category aliases before executing postgis templates', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const normalized = (agent as any).normalizeToolCall({
      id: 'tool_nearby_alias',
      name: 'postgis',
      arguments: {
        action: 'execute_spatial_sql',
        payload: {
          template: 'nearby_poi',
          categoryKey: 'cafe',
          limit: 15,
        },
      },
    })

    expect(normalized.arguments.payload).toMatchObject({
      template: 'nearby_poi',
      categoryKey: 'coffee',
      category_key: 'coffee',
    })
  })

  it('applies llm-invoked semantic selection results before building area_overview evidence', async () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const view = await (agent as any).buildEvidenceView(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '解读一下这片区域的业态结构',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        requestId: 'req_test',
        traceId: 'trace_test',
        sessionId: 'session_test',
        anchors: {},
        evidenceView: undefined,
        spatialConstraint: undefined,
        sqlValidationAttempts: 0,
        sqlValidationPassed: 0,
        toolCalls: [
          {
            id: 'tool_histogram',
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            payload: {
              template: 'area_category_histogram',
            },
            result: {
              rows: [
                { category_main: '餐饮美食', poi_count: 14 },
                { category_main: '公共厕所', poi_count: 4 },
              ],
              meta: {
                template: 'area_category_histogram',
              },
            },
          },
          {
            id: 'tool_samples',
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            payload: {
              template: 'area_representative_sample',
            },
            result: {
              rows: [
                {
                  id: 8101,
                  name: '武昌鱼馆',
                  category_main: '餐饮美食',
                  category_sub: '中餐厅',
                },
                {
                  id: 8102,
                  name: '东门公共厕所',
                  category_main: '公共厕所',
                  category_sub: '公共厕所',
                },
              ],
              meta: {
                template: 'area_representative_sample',
              },
            },
          },
          {
            id: 'tool_semantic_selection',
            skill: 'semantic_selector',
            action: 'select_area_evidence',
            status: 'done',
            payload: {
              raw_query: '解读一下这片区域的业态结构',
              semantic_focus: '业态结构',
            },
            result: {
              selected_rows: [
                {
                  id: 8101,
                  name: '武昌鱼馆',
                  category_main: '餐饮美食',
                  category_sub: '中餐厅',
                },
              ],
              selected_area_insight: {
                categoryHistogram: [
                  { category_main: '餐饮美食', poi_count: 14 },
                ],
                representativeSamples: [
                  {
                    id: 8101,
                    name: '武昌鱼馆',
                    category_main: '餐饮美食',
                    category_sub: '中餐厅',
                  },
                ],
                competitionDensity: [],
                hotspotCells: [],
                ringDistribution: [],
                aoiContext: [],
                landuseContext: [],
              },
              semantic_evidence: {
                dependency: 'spatial_encoder',
                level: 'available',
                weakEvidence: false,
                mode: 'remote',
                reason: null,
                target: 'http://encoder.test',
              },
              diagnostics: {
                applied: true,
                mode: 'query_driven',
                focusQuery: '业态结构',
                selectedCategories: ['餐饮美食'],
                selectedSamples: ['武昌鱼馆'],
                skippedCategories: ['公共厕所'],
                skippedSamples: ['东门公共厕所'],
                threshold: 0.62,
              },
            },
          },
        ],
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
      },
    )

    expect(view.areaProfile?.dominantCategories.map((item: { label: string }) => item.label)).toEqual(['餐饮美食'])
    expect((view.meta as Record<string, unknown>).semantic_selection).toMatchObject({
      selectedCategories: ['餐饮美食'],
    })
    expect(view.semanticEvidence?.level).toBe('available')
  })

  it('honors an applied semantic selection result even when it intentionally removes all representative samples', async () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const view = await (agent as any).buildEvidenceView(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '解读一下这片区域的业态结构',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        requestId: 'req_test',
        traceId: 'trace_test',
        sessionId: 'session_test',
        anchors: {},
        evidenceView: undefined,
        spatialConstraint: undefined,
        sqlValidationAttempts: 0,
        sqlValidationPassed: 0,
        toolCalls: [
          {
            id: 'tool_histogram',
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            payload: {
              template: 'area_category_histogram',
            },
            result: {
              rows: [
                { category_main: '餐饮美食', poi_count: 14 },
                { category_main: '通行设施', poi_count: 10 },
              ],
              meta: {
                template: 'area_category_histogram',
              },
            },
          },
          {
            id: 'tool_samples',
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            payload: {
              template: 'area_representative_sample',
            },
            result: {
              rows: [
                {
                  id: 9102,
                  name: '东门停车场',
                  category_main: '交通设施服务',
                  category_sub: '停车场',
                },
              ],
              meta: {
                template: 'area_representative_sample',
              },
            },
          },
          {
            id: 'tool_semantic_selection_empty_samples',
            skill: 'semantic_selector',
            action: 'select_area_evidence',
            status: 'done',
            payload: {
              raw_query: '解读一下这片区域的业态结构',
              semantic_focus: '业态结构',
            },
            result: {
              selected_rows: [],
              selected_area_insight: {
                categoryHistogram: [
                  { category_main: '餐饮美食', poi_count: 14 },
                ],
                representativeSamples: [],
                competitionDensity: [],
                hotspotCells: [],
                ringDistribution: [],
                aoiContext: [],
                landuseContext: [],
              },
              semantic_evidence: {
                dependency: 'spatial_encoder',
                level: 'available',
                weakEvidence: false,
                mode: 'remote',
                reason: null,
                target: 'http://encoder.test',
              },
              diagnostics: {
                applied: true,
                mode: 'query_driven',
                focusQuery: '业态结构',
                selectedCategories: ['餐饮美食'],
                selectedSamples: [],
                skippedCategories: ['通行设施'],
                skippedSamples: ['东门停车场'],
                threshold: 0.73,
              },
            },
          },
        ],
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
      },
    )

    expect((view.representativeSamples || []).length).toBe(0)
    expect((view.meta as Record<string, unknown>).semantic_selection).toMatchObject({
      selectedSamples: [],
      skippedSamples: ['东门停车场'],
    })
  })

  it('expands the nearby metro limit so exits do not get truncated too early', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '湖北大学附近有哪些地铁站',
        placeName: '湖北大学',
        anchorSource: 'place',
        targetCategory: '地铁站',
        categoryKey: 'metro_station',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '湖北大学',
        display_name: '湖北大学',
        role: 'primary',
        source: 'resolved_anchor',
        resolved_place_name: '湖北大学',
        poi_id: null,
        lon: 114.332,
        lat: 30.585,
      },
      'metro_station',
      5,
    )

    expect(sql).toContain("category_sub = '地铁站'")
    expect(sql).toContain('LIMIT 12')
  })

  it('records anchor coordinate system in analysis stats', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const stats = (agent as any).buildStats({
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '当前位置附近的地铁站',
        placeName: '当前位置',
        anchorSource: 'user_location',
        targetCategory: '地铁站',
        categoryKey: 'metro_station',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
      },
      startedAt: Date.now() - 10,
      traceId: 'trace_test',
      sessionId: 'session_test',
      providerReady: true,
      evidenceCount: 2,
      anchor: {
        place_name: '当前位置',
        display_name: '当前位置',
        role: 'primary',
        source: 'user_location',
        resolved_place_name: '当前位置',
        poi_id: null,
        lon: 114.33,
        lat: 30.58,
        coord_sys: 'wgs84',
      },
      toolCalls: [],
      decision: 'grounded',
    })

    expect(stats.anchor_coord_sys).toBe('wgs84')
  })

  it('gives analysis tasks a longer tool-calling round budget than query tasks', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    expect((agent as any).resolveToolLoopMaxRounds('analysis')).toBeGreaterThan((agent as any).resolveToolLoopMaxRounds('query'))
    expect((agent as any).resolveToolLoopMaxRounds('query')).toBe(4)
  })

  it('treats structural area-overview evidence as valid support even when representative poi rows are empty', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const view = {
      ...buildAreaOverviewEvidenceView(),
      items: [],
      representativeSamples: [],
    }

    expect((agent as any).resolveEvidenceCount(view)).toBeGreaterThan(0)
  })

  it('builds area-overview sql without category filters so current-area insights can sample the full mix', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      80,
    )

    expect(sql).not.toContain("category_sub = '地铁站'")
    expect(sql).not.toContain("category_main = '餐饮美食'")
    expect(sql).toContain('LIMIT 80')
  })

  it('builds area-category-histogram sql with grouped counts instead of raw poi samples', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      8,
      'area_category_histogram',
    )

    expect(sql).toContain('COUNT(id) AS poi_count')
    expect(sql).toContain('GROUP BY category_main')
    expect(sql).toContain('ORDER BY poi_count DESC')
  })

  it('builds area-ring-distribution sql with explicit distance bands', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      8,
      'area_ring_distribution',
    )

    expect(sql).toContain("AS ring_label")
    expect(sql).toContain("AS ring_order")
    expect(sql).toContain('GROUP BY ring_label, ring_order')
  })

  it('builds representative-sample sql with grid-aware sampling so samples do not collapse into one cell', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      18,
      'area_representative_sample',
    )

    expect(sql).toContain('category_main')
    expect(sql).toContain('category_sub')
    expect(sql).toContain('ST_SnapToGrid')
    expect(sql).toContain('cell_rank = 1')
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain('ORDER BY pass_order ASC')
    expect(sql).toContain('LIMIT 18')
  })

  it('builds competition-density sql with density metrics and category filters when a target business is specified', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '如果在这里开一家咖啡店怎么样',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        categoryKey: 'coffee',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      'coffee',
      6,
      'area_competition_density',
    )

    expect(sql).toContain('AVG(ST_Distance')
    expect(sql).toContain('MIN(ST_Distance')
    expect(sql).toContain("AND category_main = '餐饮美食'")
    expect(sql).toContain("AND category_sub = '咖啡'")
  })

  it('builds hotspot sql with grid aggregation instead of plain poi listing', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      5,
      'area_h3_hotspots',
    )

    expect(sql).toContain('ST_SquareGrid')
    expect(sql).toContain('GROUP BY grid.geom')
    expect(sql).toContain('ORDER BY poi_count DESC')
  })

  it('builds AOI context sql on the aois table for area insight naming and semantic correction', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      5,
      'area_aoi_context',
    )

    expect(sql).toContain('FROM aois')
    expect(sql).toContain('ST_Intersects')
    expect(sql).toContain('ORDER BY population DESC NULLS LAST, area_sqm DESC')
    expect(sql).toContain('LIMIT 5')
  })

  it('builds landuse context sql on the landuse table for area structure explanation', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.334,
        lat: 30.577,
        coord_sys: 'gcj02',
      },
      '',
      6,
      'area_landuse_context',
    )

    expect(sql).toContain('FROM landuse')
    expect(sql).toContain('SUM(area_sqm) AS total_area_sqm')
    expect(sql).toContain('GROUP BY land_type')
    expect(sql).toContain('LIMIT 6')
  })

  it('prefers drawn boundary over viewport when deriving the current-area spatial constraint', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const spatialConstraint = (agent as any).buildSpatialConstraint({
      messages: [{ role: 'user', content: '请快速读懂当前区域' }],
      options: {
        selectedCategories: ['餐饮美食'],
        spatialContext: {
          viewport: [114.30, 30.54, 114.38, 30.60],
          boundary: [
            [114.331, 30.575],
            [114.336, 30.575],
            [114.336, 30.579],
            [114.331, 30.579],
          ],
          mapZoom: 15,
        },
      },
    })

    expect(spatialConstraint.scope).toBe('boundary')
    expect(spatialConstraint.selectedCategories).toEqual(['餐饮美食'])
    expect(spatialConstraint.areaWkt).toBe('POLYGON((114.331 30.575, 114.336 30.575, 114.336 30.579, 114.331 30.579, 114.331 30.575))')
  })

  it('builds area sql against the viewport polygon instead of collapsing back to center-radius', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.34,
        lat: 30.57,
        coord_sys: 'gcj02',
      },
      '',
      18,
      'area_representative_sample',
      {
        scope: 'viewport',
        areaWkt: 'POLYGON((114.3 30.54, 114.38 30.54, 114.38 30.6, 114.3 30.6, 114.3 30.54))',
        selectedCategories: [],
        regions: [],
      },
    )

    expect(sql).toContain("WHERE ST_Intersects(geom, ST_GeomFromText('POLYGON((114.3 30.54, 114.38 30.54, 114.38 30.6, 114.3 30.6, 114.3 30.54))', 4326))")
    expect(sql).not.toContain('WHERE ST_DWithin(')
    expect(sql).toContain('ST_SnapToGrid')
    expect(sql).toContain('ORDER BY pass_order ASC')
  })

  it('stacks selected-category filters on top of the spatial area filter for area insight sql', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const sql = (agent as any).buildTemplateSQL(
      {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '请快速读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      {
        place_name: '当前区域',
        display_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        resolved_place_name: '当前区域',
        poi_id: null,
        lon: 114.34,
        lat: 30.57,
        coord_sys: 'gcj02',
      },
      '',
      8,
      'area_category_histogram',
      {
        scope: 'boundary',
        areaWkt: 'POLYGON((114.331 30.575, 114.336 30.575, 114.336 30.579, 114.331 30.579, 114.331 30.575))',
        selectedCategories: ['餐饮美食', '咖啡'],
        regions: [],
      },
    )

    expect(sql).toContain("ST_GeomFromText('POLYGON((114.331 30.575, 114.336 30.575, 114.336 30.579, 114.331 30.579, 114.331 30.575))', 4326)")
    expect(sql).toContain("AND (category_main IN ('餐饮美食', '咖啡') OR category_sub IN ('餐饮美食', '咖啡'))")
  })

  it('accepts area-overview answers that mention the semantic type hint without repeating the full anchor title', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const grounded = (agent as any).isAnswerGrounded(
      '这更像一个校园片区，供给以餐饮和生活服务为主，多核活力比较明显。',
      buildAreaOverviewEvidenceView(),
    )

    expect(grounded).toBe(true)
  })

  it('accepts area-overview answers that hit multiple supporting evidence cues even when the anchor name is omitted', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const grounded = (agent as any).isAnswerGrounded(
      '这片区域整体呈现校园主导、多核活力的结构，餐饮和生活服务是主要供给。',
      buildAreaOverviewEvidenceView(),
    )

    expect(grounded).toBe(true)
  })

  it('uses a compact synthesis prompt for area-overview final writing instead of replaying the deterministic draft', async () => {
    const captured: Array<{ role: string, content: string | null }> = []
    const provider: LLMProvider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        model: 'test-synth-model',
        provider: 'test-provider',
      }),
      complete: vi.fn(async (request: LLMCompletionRequest): Promise<LLMResponse> => {
        captured.push(...request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })))
        return {
          assistantMessage: {
            role: 'assistant' as const,
            content: '## 区域主语\n武汉大学校园片区\n\n## 关键特征\n校园主导，多核活力明显，餐饮和生活服务是主要支撑。',
            toolCalls: [],
          },
          toolCalls: [],
          finishReason: 'stop' as const,
        }
      }),
    }

    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
      provider,
    })

    const answer = await (agent as any).synthesizeGroundedAnswer({
      provider,
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '解读一下武汉大学周边的业态结构',
        placeName: '武汉大学',
        anchorSource: 'place',
        secondaryPlaceName: null,
        targetCategory: null,
        comparisonTarget: null,
        categoryKey: null,
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      evidenceView: buildAreaOverviewEvidenceView(),
      rendered: {
        answer: '## 区域主语\n- 当前范围更适合看作**武汉大学校园片区**',
        summary: 'deterministic',
        pois: [],
        stats: {},
      },
      spatialConstraint: null,
      rawQuery: '解读一下武汉大学周边的业态结构',
    })

    const synthesisPrompt = captured.find((message) => message.role === 'user')?.content || ''

    expect(answer).toContain('武汉大学校园片区')
    expect(synthesisPrompt).toContain('只基于下面证据写最终回答')
    expect(synthesisPrompt).toContain('## 区域主语 / ## 关键特征 / ## 热点与结构 / ## 机会与风险')
    expect(synthesisPrompt).toContain('片区特征: 校园主导、多核活力')
    expect(synthesisPrompt).not.toContain('机械兜底草稿')
    expect(synthesisPrompt).not.toContain('置信度:')
  })

  it('still rejects area-overview answers that miss both the subject and the evidence cues', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const grounded = (agent as any).isAnswerGrounded(
      '这里更像一个高端商业片区，奢侈零售会是最稳的方向。',
      buildAreaOverviewEvidenceView(),
    )

    expect(grounded).toBe(false)
  })

  it('uses LLM-first intent understanding even when fallback intent stays conservative', async () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
      provider: createJsonProvider({
        queryType: 'area_overview',
        anchorSource: 'place',
        placeName: '武汉大学',
        needsClarification: false,
        clarificationHint: null,
      }),
    })

    const intent = await (agent as any).reinterpretIntentWithLlmIfNeeded({
      request: {
        messages: [{ role: 'user', content: '解读一下武汉大学周边的业态结构' }],
        options: {},
      },
      rawQuery: '解读一下武汉大学周边的业态结构',
      fallbackIntent: {
        queryType: 'unsupported',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '解读一下武汉大学周边的业态结构',
        placeName: null,
        anchorSource: 'place',
        secondaryPlaceName: null,
        targetCategory: null,
        comparisonTarget: null,
        categoryKey: null,
        radiusM: 800,
        needsClarification: true,
        clarificationHint: '请更明确说明你的查询目标。',
      },
      providerReady: true,
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.intentMode).toBe('agent_full_loop')
    expect(intent.anchorSource).toBe('place')
    expect(intent.placeName).toBe('武汉大学')
    expect(intent.needsClarification).toBe(false)
  })

  it('prefers llm intent planning for map-view queries even when embedding is confident', async () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
      provider: createJsonProvider({
        queryType: 'nearby_poi',
        anchorSource: 'map_view',
        placeName: null,
        targetCategory: '酒店',
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
        toolIntent: 'candidate_reputation',
        searchIntentHint: '酒店 评分 推荐',
      }),
      intentClassifier: {
        isReady: true,
        classify: async () => ({
          queryType: 'nearby_poi',
          confidence: 0.92,
          needsWebSearch: true,
          webSearchConfidence: 0.88,
          latencyMs: 12,
          usedEmbedding: true,
        }),
      } as any,
    })

    const resolution = await (agent as any).resolveIntent({
      request: {
        messages: [{ role: 'user', content: '这块有哪些高分推荐的酒店？' }],
        options: {
          spatialContext: {
            viewport: [114.3, 30.55, 114.34, 30.58],
            center: { lon: 114.32, lat: 30.565 },
          },
        },
      },
      rawQuery: '这块有哪些高分推荐的酒店？',
      fallbackIntent: {
        queryType: 'unsupported',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '这块有哪些高分推荐的酒店？',
        placeName: null,
        anchorSource: 'map_view',
        secondaryPlaceName: null,
        targetCategory: null,
        comparisonTarget: null,
        categoryKey: null,
        radiusM: 800,
        needsClarification: true,
        clarificationHint: '请更明确说明你的查询目标。',
      },
      followUpHint: null,
      providerReady: true,
    })

    expect(resolution.source).toBe('llm')
    expect(resolution.intent.queryType).toBe('nearby_poi')
    expect(resolution.intent.anchorSource).toBe('map_view')
    expect(resolution.intent.toolIntent).toBe('candidate_reputation')
    expect(resolution.intent.searchIntentHint).toBe('酒店 评分 推荐')
  })

  it('builds a structured tool-loop handoff from the resolved LLM intent instead of reusing raw phrasing', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const message = (agent as any).buildToolLoopUserMessage({
      rawQuery: '解读一下武汉大学周边的业态结构',
      intentSource: 'llm',
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '解读一下武汉大学周边的业态结构',
        placeName: '武汉大学',
        anchorSource: 'place',
        secondaryPlaceName: null,
        targetCategory: '区域洞察',
        comparisonTarget: null,
        categoryKey: null,
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
    })

    expect(message).toContain('用户原问题：解读一下武汉大学周边的业态结构')
    expect(message).toContain('当前意图来源：llm')
    expect(message).toContain('当前意图理解：area_overview')
    expect(message).toContain('当前锚点模式：place')
    expect(message).toContain('主锚点：武汉大学')
    expect(message).toContain('编排要求：这是区域洞察题')
    expect(message).not.toBe('解读一下武汉大学周边的业态结构')
  })

  it('teaches the tool loop to emit independent calls in parallel and route focused area questions through semantic_selector', () => {
    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
    })

    const message = (agent as any).buildToolLoopUserMessage({
      rawQuery: '当前区域的咖啡店分布怎么样',
      intentSource: 'llm',
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '当前区域的咖啡店分布怎么样',
        placeName: '当前区域',
        anchorSource: 'map_view',
        secondaryPlaceName: null,
        targetCategory: '区域洞察',
        comparisonTarget: null,
        categoryKey: 'coffee',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
    })

    expect(message).toContain('如果多个工具彼此没有前后输入依赖，应在同一轮直接给出多个 tool calls 并行执行')
    expect(message).toContain('拿到 area insight 后')
    expect(message).toContain('semantic_selector.select_area_evidence')
  })

  it('does not hard-force a medium-confidence deterministic area subject into the final synthesis prompt', async () => {
    const captured: LLMCompletionRequest['messages'][] = []
    const provider: LLMProvider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        model: 'test-synthesis-model',
        provider: 'test-provider',
      }),
      complete: async (request) => {
        captured.push(request.messages)
        return {
          assistantMessage: {
            role: 'assistant',
            content: '## 区域主语\n- 这里更像广埠屯商圈居住商业混合片区',
            toolCalls: [],
          },
          toolCalls: [],
          finishReason: 'stop',
        }
      },
    }

    const agent = new GeoLoomAgent({
      registry: new SkillRegistry(),
      version: 'test',
      provider,
    })

    await (agent as any).synthesizeGroundedAnswer({
      provider,
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '总结一下这个区域的业态结构',
        placeName: '当前区域',
        anchorSource: 'map_view',
        secondaryPlaceName: null,
        targetCategory: '区域洞察',
        comparisonTarget: null,
        categoryKey: null,
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
      },
      evidenceView: {
        ...buildAreaOverviewEvidenceView(),
        areaSubject: {
          title: '武汉大学校园片区',
          anchorName: '武汉大学',
          typeHint: '校园片区',
          confidence: 'medium',
        },
        aoiContext: [
          { id: 1, name: '广埠屯商圈', fclass: 'commercial', areaSqm: 240000, population: 0 },
          { id: 2, name: '珞珈山社区', fclass: 'residential', areaSqm: 190000, population: 0 },
        ],
        landuseContext: [
          { landType: 'commercial', parcelCount: 6, totalAreaSqm: 110000 },
          { landType: 'residential', parcelCount: 8, totalAreaSqm: 98000 },
        ],
      },
      rendered: {
        answer: '## 区域主语\n- 当前范围更适合看作**武汉大学校园片区**',
        summary: 'deterministic',
        pois: [],
        stats: {},
      },
      spatialConstraint: null,
      rawQuery: '总结一下这个区域的业态结构',
    })

    const synthesisPrompt = captured.at(-1)?.find((message) => message.role === 'user')?.content || ''

    expect(synthesisPrompt).toContain('必须明确写出区域主语，不要只写“当前区域”。')
    expect(synthesisPrompt).toContain('如果 AOI / 用地信号是混合的，优先选择更宽、证据更充分的区域主语')
    expect(synthesisPrompt).not.toContain('必须直接写“武汉大学校园片区”')
  })
})
