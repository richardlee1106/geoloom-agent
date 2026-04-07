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
})
