import { describe, expect, it } from 'vitest'

import { GeoLoomAgent } from '../../../src/agent/GeoLoomAgent.js'

describe('GeoLoomAgent large viewport SQL', () => {
  it('switches representative-sample SQL to tile-aware viewport synthesis for large map views', () => {
    const helper = GeoLoomAgent.prototype as any
    const sql = helper.buildAreaInsightTemplateSQL.call(helper, {
      templateName: 'area_representative_sample',
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: '读懂当前区域',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
        viewportContext: {
          diagonalM: 8600,
          scale: 'large',
          bounds: {
            swLon: 114.30,
            swLat: 30.52,
            neLon: 114.38,
            neLat: 30.60,
          },
        },
      },
      anchor: {
        place_name: '当前区域',
        display_name: '当前区域',
        resolved_place_name: '当前区域',
        role: 'primary',
        source: 'map_view',
        poi_id: null,
        lon: 114.34,
        lat: 30.56,
      },
      categoryKey: '',
      limit: 6,
      spatialConstraint: {
        scope: 'viewport',
        areaWkt: 'POLYGON((114.30 30.52,114.38 30.52,114.38 30.60,114.30 30.60,114.30 30.52))',
        selectedCategories: [],
        regions: [],
      },
    })

    expect(sql).toContain('tile_x')
    expect(sql).toContain('tile_y')
    expect(sql).toContain('anchor_priority')
    expect(sql).toContain('LIMIT 8')
  })
})
