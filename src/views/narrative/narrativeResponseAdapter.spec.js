import { describe, expect, it } from 'vitest'

import { adaptNarrativeResponse } from './narrativeResponseAdapter.ts'

function baseResponse(region) {
  return {
    session_id: 'test-session',
    state_version: 1,
    scene_profile: 'natural_ecology',
    lod: 'meso',
    viewport: {
      west: 114.3,
      south: 30.5,
      east: 114.4,
      north: 30.6,
      zoom: 14,
      center: [114.35, 30.55]
    },
    dominant_coverage: 0.2,
    candidate_count: 1,
    poi_density: 1,
    semantic_diversity: 0.2,
    regions: [region],
    path: {
      nodes: [{ region_id: region.id, narration_role: 'ecological', transition_reason: '测试转场' }],
      seed: 'seed',
      alternatives_count: 0
    },
    narration: {
      chapters: [{ region_id: region.id, text: '测试解说', length_ms: 1000 }],
      tone: 'science'
    },
    user_context: {
      time_label: '当前时段',
      weather_label: '未指定',
      preference_label: '通用解说',
      history_label: '首次进入'
    }
  }
}

describe('adaptNarrativeResponse', () => {
  it('保留只有弱 POI 的片区热力兜底点', () => {
    const region = {
      id: 'shahu-a',
      display_name: '沙湖公园A区',
      role: 'primary_region',
      core_anchor: { id: 'shahu-a', lon: 114.34, lat: 30.54 },
      boundary: { type: 'Polygon', coordinates: [[[114.33, 30.53], [114.35, 30.53], [114.35, 30.55], [114.33, 30.55], [114.33, 30.53]]] },
      visual_layer: {
        mode: 'region_glow',
        poi_heat: {
          radius: 24,
          points: [{ lon: 114.34, lat: 30.54, tier: 'weak' }]
        }
      },
      pois: [
        {
          id: 'parking-a',
          lon: 114.34,
          lat: 30.54,
          display_name: '沙湖公园A区停车场',
          tier: 'weak',
          role: 'background_ecology',
          category_main: '交通设施服务'
        }
      ],
      narrative_facts: []
    }

    const model = adaptNarrativeResponse(baseResponse(region))

    expect(model.regions[0].pois).toHaveLength(1)
    expect(model.regions[0].visual_layer.poi_heat.points).toEqual([
      { lon: 114.34, lat: 30.54, tier: 'weak' }
    ])
    expect(model.allRenderablePois[0].tier).toBe('weak')
  })

  it('不会把热力点反向伪造成真实 POI', () => {
    const region = {
      id: 'xudong',
      display_name: '徐东商圈',
      role: 'primary_region',
      core_anchor: { id: 'xudong', lon: 114.34, lat: 30.54 },
      boundary: { type: 'Polygon', coordinates: [[[114.33, 30.53], [114.35, 30.53], [114.35, 30.55], [114.33, 30.55], [114.33, 30.53]]] },
      visual_layer: {
        mode: 'region_glow',
        poi_heat: {
          radius: 24,
          points: [{ lon: 114.34, lat: 30.54, tier: 'medium' }]
        }
      },
      pois: [],
      narrative_facts: []
    }

    const model = adaptNarrativeResponse(baseResponse(region))

    expect(model.regions).toHaveLength(0)
    expect(model.pathNodes).toHaveLength(0)
    expect(model.chapters).toHaveLength(0)
    expect(model.allRenderablePois).toHaveLength(0)
  })

  it('过滤无效片区名和路径节点，避免地图显示 None 标签', () => {
    const region = {
      id: 'invalid-region',
      display_name: 'None',
      role: 'scene_evidence',
      core_anchor: { id: 'invalid-region', lon: 114.34, lat: 30.54 },
      boundary: { type: 'Polygon', coordinates: [[[114.33, 30.53], [114.35, 30.53], [114.35, 30.55], [114.33, 30.55], [114.33, 30.53]]] },
      visual_layer: { mode: 'region_glow', poi_heat: { radius: 24, points: [] } },
      pois: [],
      narrative_facts: []
    }

    const model = adaptNarrativeResponse(baseResponse(region))

    expect(model.regions).toHaveLength(0)
    expect(model.pathNodes).toHaveLength(0)
    expect(model.chapters).toHaveLength(0)
  })

  it('过滤片区边界外的缓存和散点，避免出现无归属零碎点', () => {
    const region = {
      id: 'valid-region',
      display_name: '有效片区',
      role: 'scene_evidence',
      core_anchor: { id: 'valid-region', lon: 114.34, lat: 30.54 },
      boundary: { type: 'Polygon', coordinates: [[[114.33, 30.53], [114.35, 30.53], [114.35, 30.55], [114.33, 30.55], [114.33, 30.53]]] },
      visual_layer: { mode: 'region_glow', poi_heat: { radius: 24, points: [] } },
      pois: [
        { id: 'inside', lon: 114.34, lat: 30.54, display_name: '片区内点', tier: 'medium', role: 'scene_evidence', category_main: '购物服务' },
        { id: 'outside', lon: 114.39, lat: 30.59, display_name: '片区外点', tier: 'medium', role: 'scene_evidence', category_main: '购物服务' }
      ],
      narrative_facts: []
    }

    const model = adaptNarrativeResponse(baseResponse(region))

    expect(model.allRenderablePois.map((poi) => poi.id)).toEqual(['inside'])
  })

  it('同名片区的新响应不会复用上一响应的旧 POI 缓存', () => {
    const firstRegion = {
      id: 'xudong-old',
      display_name: '徐东商圈',
      role: 'primary_region',
      core_anchor: { id: 'xudong-old', lon: 114.34, lat: 30.54 },
      boundary: { type: 'Polygon', coordinates: [[[114.33, 30.53], [114.35, 30.53], [114.35, 30.55], [114.33, 30.55], [114.33, 30.53]]] },
      visual_layer: { mode: 'region_glow', poi_heat: { radius: 24, points: [] } },
      pois: [
        { id: 'old-poi', lon: 114.34, lat: 30.54, display_name: '旧响应 POI', tier: 'medium', role: 'scene_evidence', category_main: '购物服务' }
      ],
      narrative_facts: []
    }
    const nextRegion = {
      ...firstRegion,
      id: 'xudong-new',
      core_anchor: { id: 'xudong-new', lon: 114.341, lat: 30.541 },
      pois: [
        { id: 'new-poi', lon: 114.341, lat: 30.541, display_name: '新响应 POI', tier: 'medium', role: 'scene_evidence', category_main: '购物服务' }
      ]
    }

    adaptNarrativeResponse(baseResponse(firstRegion))
    const model = adaptNarrativeResponse(baseResponse(nextRegion))

    expect(model.allRenderablePois.map((poi) => poi.id)).toEqual(['new-poi'])
  })
})
