import { describe, expect, it } from 'vitest'

import { Renderer } from '../../../src/evidence/Renderer.js'

describe('Renderer', () => {
  const renderer = new Renderer()

  it('renders poi_list evidence into fixed deterministic text', () => {
    const answer = renderer.render({
      type: 'poi_list',
      anchor: {
        placeName: '武汉大学',
        displayName: '武汉大学',
        resolvedPlaceName: '武汉大学',
      },
      items: [
        {
          name: 'luckin coffee',
          category: '咖啡',
          distance_m: 123.7,
        },
      ],
      meta: {
        radiusM: 800,
        targetCategory: '咖啡',
      },
    })

    expect(answer).toMatch(/## 推荐结论/)
    expect(answer).toMatch(/## 就近可选/)
    expect(answer).toMatch(/## 使用说明/)
    expect(answer).toMatch(/武汉大学/)
    expect(answer).toMatch(/luckin coffee/)
    expect(answer).toMatch(/800 米/)
  })

  it('lists every nearby poi when the result set is still compact', () => {
    const answer = renderer.render({
      type: 'poi_list',
      anchor: {
        placeName: '湖北大学',
        displayName: '湖北大学',
        resolvedPlaceName: '湖北大学武昌校区',
      },
      items: [
        { name: '湖北大学地铁站E口', category: '地铁站', distance_m: 372 },
        { name: '湖北大学地铁站A口', category: '地铁站', distance_m: 448 },
        { name: '湖北大学地铁站D口', category: '地铁站', distance_m: 448 },
        { name: '湖北大学地铁站C口', category: '地铁站', distance_m: 475 },
        { name: '湖北大学地铁站B口', category: '地铁站', distance_m: 566 },
        { name: '秦园路(地铁站)', category: '地铁站', distance_m: 612 },
      ],
      meta: {
        radiusM: 800,
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/^## 推荐结论/m)
    expect(answer).toMatch(/## 就近可选/)
    expect(answer).toMatch(/当前共保留 6 个地铁站相关地点/)
    expect(answer).toMatch(/1\. 湖北大学地铁站E口/)
    expect(answer).toMatch(/6\. 秦园路\(地铁站\)/)
  })

  it('surfaces macro district constraints in soft-scoped nearby markdown', () => {
    const answer = renderer.render({
      type: 'poi_list',
      anchor: {
        placeName: '汉口',
        displayName: '汉口',
        resolvedPlaceName: '汉口',
      },
      items: [
        { name: '老通城', category: '小吃快餐', distance_m: 1800 },
        { name: '四季美', category: '小吃快餐', distance_m: 2200 },
      ],
      meta: {
        radiusM: 8000,
        distanceConstraintMode: 'soft',
        targetCategory: '餐饮美食',
        scopeLabel: '汉口片区',
        scopeDistricts: ['江汉区', '江岸区', '硚口区'],
      },
    })

    expect(answer).toMatch(/围绕汉口片区/)
    expect(answer).toMatch(/江汉区、江岸区、硚口区/)
    expect(answer).toMatch(/片区级结果/)
  })

  it('renders transport evidence into a nearest-station sentence', () => {
    const answer = renderer.render({
      type: 'transport',
      anchor: {
        placeName: '武汉大学',
        displayName: '武汉大学',
        resolvedPlaceName: '武汉大学',
      },
      items: [
        {
          name: '小洪山地铁站A口',
          category: '地铁站',
          distance_m: 1027.9,
        },
      ],
      meta: {
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/武汉大学/)
    expect(answer).toMatch(/小洪山地铁站A口/)
    expect(answer).toMatch(/1028|1027.9/)
  })

  it('lists exits for the nearest metro station and identifies the closest exit', () => {
    const answer = renderer.render({
      type: 'transport',
      anchor: {
        placeName: '湖北大学',
        displayName: '湖北大学',
        resolvedPlaceName: '湖北大学武昌校区',
      },
      items: [
        {
          name: '湖北大学地铁站E口',
          category: '地铁站',
          distance_m: 464.8,
        },
        {
          name: '湖北大学地铁站A口',
          category: '地铁站',
          distance_m: 558.9,
        },
        {
          name: '湖北大学地铁站D口',
          category: '地铁站',
          distance_m: 559.5,
        },
        {
          name: '湖北大学(地铁站)',
          category: '地铁站',
          distance_m: 571.5,
        },
        {
          name: '湖北大学地铁站C口',
          category: '地铁站',
          distance_m: 592.8,
        },
        {
          name: '湖北大学地铁站B口',
          category: '地铁站',
          distance_m: 706.2,
        },
      ],
      meta: {
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/湖北大学武昌校区/)
    expect(answer).toMatch(/湖北大学地铁站/)
    expect(answer).toMatch(/E口/)
    expect(answer).toMatch(/A口、D口、C口、B口|E口、A口、D口、C口、B口/)
    expect(answer).toMatch(/最近|最近的出口/)
  })

  it('renders area-overview evidence into an honest fallback summary when only basic samples are available', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '湖北大学地铁站E口',
          category: '地铁站',
          categoryMain: '交通设施服务',
          distance_m: 120,
        },
        {
          name: '武昌鱼馆',
          category: '中餐厅',
          categoryMain: '餐饮美食',
          distance_m: 180,
        },
        {
          name: '校园便利店',
          category: '便利店',
          categoryMain: '购物服务',
          distance_m: 260,
        },
        {
          name: '咖啡实验室',
          category: '咖啡',
          categoryMain: '餐饮美食',
          distance_m: 320,
        },
      ],
      buckets: [
        { label: '餐饮美食', value: 2 },
        { label: '交通设施服务', value: 1 },
        { label: '购物服务', value: 1 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    })

    expect(answer).toMatch(/基础周边样本汇总/)
    expect(answer).toMatch(/先不直接下机会结论/)
    expect(answer).toMatch(/正式片区判断/)
    expect(answer).not.toMatch(/范围内 \d+ 个|样本量还偏少（当前 \d+ 个）/)
  })

  it('renders structured area-insight evidence into a markdown analysis frame instead of a sample recap', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '深夜食堂',
          category: '中餐厅',
          categoryMain: '餐饮美食',
          distance_m: 140,
        },
        {
          name: '便利蜂',
          category: '便利店',
          categoryMain: '购物服务',
          distance_m: 210,
        },
      ],
      buckets: [
        { label: '餐饮美食', value: 14 },
        { label: '购物服务', value: 6 },
        { label: '交通设施服务', value: 4 },
      ],
      areaProfile: {
        totalCount: 24,
        dominantCategories: [
          { label: '餐饮美食', count: 14, share: 0.58 },
          { label: '购物服务', count: 6, share: 0.25 },
        ],
        lowSignalRatio: 0.08,
        ringFootfall: [
          { label: '0-300m', count: 12, share: 0.5 },
          { label: '300-600m', count: 8, share: 0.33 },
        ],
      },
      hotspots: [
        { label: '深夜食堂、便利蜂一带', poiCount: 9 },
      ],
      anomalySignals: [
        { title: '餐饮占比偏高', detail: '餐饮美食占比接近 6 成，结构明显偏向吃喝。', score: 0.76 },
      ],
      opportunitySignals: [
        { title: '生活服务补位机会', detail: '零售和交通有了，但生活服务类信号仍偏弱。', score: 0.63 },
      ],
      representativeSamples: [
        { name: '深夜食堂', category: '中餐厅', categoryMain: '餐饮美食', distance_m: 140 },
        { name: '便利蜂', category: '便利店', categoryMain: '购物服务', distance_m: 210 },
      ],
      confidence: {
        score: 0.72,
        level: 'medium',
        reasons: ['已拿到结构分布、热点和代表样本'],
      },
      areaSubject: {
        title: '湖北大学校园生活带',
        anchorName: '湖北大学',
        confidence: 'high',
      },
      aoiContext: [
        { name: '湖北大学', fclass: 'school', areaSqm: 180000 },
        { name: '湖北大学生活区', fclass: 'residential', areaSqm: 120000 },
      ],
      landuseContext: [
        { landType: 'education', parcelCount: 3, totalAreaSqm: 93000 },
        { landType: 'residential', parcelCount: 6, totalAreaSqm: 86000 },
        { landType: 'commercial', parcelCount: 4, totalAreaSqm: 52000 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    } as any)

    expect(answer).toMatch(/^## /m)
    expect(answer).toMatch(/## 区域主语/)
    expect(answer).toMatch(/## 关键特征/)
    expect(answer).toMatch(/## 热点与结构/)
    expect(answer).toMatch(/## 机会与风险/)
    expect(answer).toMatch(/湖北大学/)
    expect(answer).toMatch(/深夜食堂|便利蜂/)
    expect(answer).toMatch(/异常|风险/)
    expect(answer).toMatch(/机会/)
    expect(answer).not.toMatch(/范围内 14 个|9 个高密点位/)
    expect(answer).not.toMatch(/基础周边样本汇总/)
  })

  it('surfaces region snapshot features in structured area-insight markdown when the encoder has extracted them', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '湖北大学地铁站E口',
          category: '地铁站',
          categoryMain: '交通设施服务',
          distance_m: 120,
        },
        {
          name: '武昌鱼馆',
          category: '中餐厅',
          categoryMain: '餐饮美食',
          distance_m: 180,
        },
      ],
      buckets: [
        { label: '餐饮美食', value: 14 },
        { label: '购物服务', value: 6 },
      ],
      areaProfile: {
        totalCount: 20,
        dominantCategories: [
          { label: '餐饮美食', count: 14, share: 0.7 },
          { label: '购物服务', count: 6, share: 0.3 },
        ],
        lowSignalRatio: 0.03,
        ringFootfall: [{ label: '0-300m', count: 12, share: 0.6 }],
      },
      hotspots: [
        { label: '湖北大学地铁站E口、武昌鱼馆一带', poiCount: 9 },
      ],
      anomalySignals: [
        { title: '餐饮占比偏高', detail: '餐饮供给明显偏强。', score: 0.8 },
      ],
      opportunitySignals: [
        { title: '生活服务补位机会', detail: '生活服务供给还偏薄。', score: 0.7 },
      ],
      areaSubject: {
        title: '湖北大学校园生活带',
        anchorName: '湖北大学',
        confidence: 'high',
      },
      regionFeatureSummary: '编码器提取的片区特征包括：校园主导、居住商业混合、餐饮竞争偏密。',
      regionFeatures: [
        { key: 'campus_anchor', label: '校园主导', score: 0.93 },
        { key: 'mixed_use', label: '居住商业混合', score: 0.87 },
        { key: 'food_competition_dense', label: '餐饮竞争偏密', score: 0.79 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    } as any)

    expect(answer).toMatch(/编码器提取的片区特征/)
    expect(answer).toMatch(/校园主导/)
    expect(answer).toMatch(/居住商业混合/)
    expect(answer).toMatch(/餐饮竞争偏密/)
  })

  it('surfaces representative poi role features in structured area-insight markdown', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        { name: '湖北大学地铁站E口', categoryMain: '交通设施服务', categorySub: '地铁站', distance_m: 120 },
        { name: '校园便利店', categoryMain: '购物服务', categorySub: '便利店', distance_m: 180 },
      ],
      buckets: [
        { label: '餐饮美食', value: 14 },
        { label: '购物服务', value: 6 },
      ],
      areaProfile: {
        totalCount: 20,
        dominantCategories: [
          { label: '餐饮美食', count: 14, share: 0.7 },
          { label: '购物服务', count: 6, share: 0.3 },
        ],
        lowSignalRatio: 0.03,
        ringFootfall: [{ label: '0-300m', count: 12, share: 0.6 }],
      },
      hotspots: [
        { label: '湖北大学地铁站E口、武昌鱼馆一带', poiCount: 9 },
      ],
      anomalySignals: [
        { title: '餐饮占比偏高', detail: '餐饮供给明显偏强。', score: 0.8 },
      ],
      opportunitySignals: [
        { title: '生活服务补位机会', detail: '生活服务供给还偏薄。', score: 0.7 },
      ],
      areaSubject: {
        title: '湖北大学校园生活带',
        anchorName: '湖北大学',
        confidence: 'high',
      },
      representativePoiProfiles: [
        {
          name: '湖北大学地铁站E口',
          summary: '湖北大学地铁站E口更像交通接驳点、热点锚点。',
          categoryMain: '交通设施服务',
          categorySub: '地铁站',
          featureTags: [
            { key: 'transit_gateway', label: '交通接驳点', score: 0.95 },
            { key: 'hotspot_anchor', label: '热点锚点', score: 0.82 },
          ],
        },
        {
          name: '校园便利店',
          summary: '校园便利店更像日常配套支点、零售配套点。',
          categoryMain: '购物服务',
          categorySub: '便利店',
          featureTags: [
            { key: 'daily_service_node', label: '日常配套支点', score: 0.82 },
            { key: 'retail_support', label: '零售配套点', score: 0.76 },
          ],
        },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    } as any)

    expect(answer).toMatch(/交通接驳点/)
    expect(answer).toMatch(/日常配套支点/)
    expect(answer).toMatch(/湖北大学地铁站E口/)
    expect(answer).toMatch(/校园便利店/)
  })

  it('mentions AOI and landuse context in deterministic area-overview fallback when they explain a mixed-use area', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '深夜食堂',
          category: '中餐厅',
          categoryMain: '餐饮美食',
          distance_m: 140,
        },
      ],
      buckets: [
        { label: '餐饮美食', value: 14 },
        { label: '购物服务', value: 6 },
      ],
      areaProfile: {
        totalCount: 24,
        dominantCategories: [
          { label: '餐饮美食', count: 14, share: 0.58 },
          { label: '购物服务', count: 6, share: 0.25 },
        ],
        lowSignalRatio: 0.08,
        ringFootfall: [
          { label: '0-300m', count: 12, share: 0.5 },
        ],
      },
      hotspots: [
        { label: '核心热点网格', poiCount: 9 },
      ],
      anomalySignals: [
        { title: '餐饮占比偏高', detail: '餐饮美食占比接近 6 成，结构明显偏向吃喝。', score: 0.76 },
      ],
      opportunitySignals: [
        { title: '生活服务补位机会', detail: '零售和交通有了，但生活服务类信号仍偏弱。', score: 0.63 },
      ],
      aoiContext: [
        { name: '湖北大学生活区', fclass: 'residential', population: 2600, areaSqm: 180000 },
        { name: '三角路地铁商业带', fclass: 'commercial', areaSqm: 64000 },
      ],
      landuseContext: [
        { landType: 'residential', parcelCount: 7, totalAreaSqm: 86000 },
        { landType: 'commercial', parcelCount: 4, totalAreaSqm: 52000 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    })

    expect(answer).toMatch(/AOI|用地/)
    expect(answer).toMatch(/居住/)
    expect(answer).toMatch(/商业/)
    expect(answer).toMatch(/混合/)
  })

  it('downweights natural-background AOI labels and prefers human-meaningful mixed-use phrasing', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '湖北大学生活区便利店',
          category: '便利店',
          categoryMain: '购物服务',
          distance_m: 120,
        },
      ],
      buckets: [
        { label: '购物服务', value: 8 },
        { label: '餐饮美食', value: 6 },
      ],
      areaProfile: {
        totalCount: 14,
        dominantCategories: [
          { label: '购物服务', count: 8, share: 0.57 },
          { label: '餐饮美食', count: 6, share: 0.43 },
        ],
        lowSignalRatio: 0.05,
        ringFootfall: [
          { label: '0-300m', count: 8, share: 0.57 },
        ],
      },
      hotspots: [
        { label: '核心热点网格', poiCount: 6 },
      ],
      anomalySignals: [
        { title: '零售偏强', detail: '零售配套占比偏高。', score: 0.62 },
      ],
      opportunitySignals: [
        { title: '生活服务补位机会', detail: '生活服务还可以继续补位。', score: 0.61 },
      ],
      aoiContext: [
        { name: '沙湖', fclass: 'water', areaSqm: 420000 },
        { name: '湖北大学', fclass: 'school', areaSqm: 180000 },
        { name: '万隆广场', fclass: 'commercial', areaSqm: 56000 },
      ],
      landuseContext: [
        { landType: 'education', parcelCount: 3, totalAreaSqm: 93000 },
        { landType: 'residential', parcelCount: 6, totalAreaSqm: 86000 },
        { landType: 'commercial', parcelCount: 4, totalAreaSqm: 52000 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    })

    expect(answer).toMatch(/校园|居住/)
    expect(answer).toMatch(/商业/)
    expect(answer).toMatch(/混合/)
    expect(answer).not.toMatch(/湖泊主导片区|河流湖泊主导片区|水域主导片区/)
  })
})
