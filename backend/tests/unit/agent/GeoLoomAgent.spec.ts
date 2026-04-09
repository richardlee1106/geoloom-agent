import { describe, expect, it } from 'vitest'

import { GeoLoomAgent } from '../../../src/agent/GeoLoomAgent.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

describe('GeoLoomAgent metro nearby fallback SQL', () => {
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
})
