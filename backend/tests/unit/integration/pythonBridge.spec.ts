import { describe, expect, it, vi } from 'vitest'

import { LocalPythonBridge, RemoteFirstPythonBridge } from '../../../src/integration/pythonBridge.js'

describe('RemoteFirstPythonBridge', () => {
  it('extracts structured poi role features from a poi profile in local fallback mode', async () => {
    const bridge = new LocalPythonBridge()

    const encoded = await (bridge as any).encodePoiProfile({
      name: '湖北大学地铁站E口',
      categoryMain: '交通设施服务',
      categorySub: '地铁站',
      distanceM: 120,
      areaSubject: '湖北大学校园生活带',
      hotspotLabel: '湖北大学地铁站E口、武昌鱼馆一带',
      surroundingCategories: ['餐饮美食', '购物服务', '交通设施服务'],
      aoiContext: [
        { name: '湖北大学生活区', fclass: 'residential', areaSqm: 180000 },
      ],
    })

    expect(encoded.dimension).toBeGreaterThan(0)
    expect(encoded.feature_tags.map((item: { label: string }) => item.label)).toEqual(expect.arrayContaining([
      '交通接驳点',
      '热点锚点',
      '核心圈层样本',
    ]))
    expect(encoded.summary).toMatch(/湖北大学地铁站E口/)
  })

  it('extracts structured region features from a region snapshot in local fallback mode', async () => {
    const bridge = new LocalPythonBridge()

    const encoded = await (bridge as any).encodeRegionSnapshot({
      subjectName: '湖北大学校园生活带',
      dominantCategories: [
        { label: '餐饮美食', count: 14, share: 0.58 },
        { label: '购物服务', count: 6, share: 0.25 },
        { label: '交通设施服务', count: 4, share: 0.17 },
      ],
      hotspots: [
        { label: '湖北大学地铁站E口、武昌鱼馆一带', poiCount: 9 },
      ],
      representativePois: [
        { name: '湖北大学地铁站E口', categoryMain: '交通设施服务', categorySub: '地铁站' },
        { name: '武昌鱼馆', categoryMain: '餐饮美食', categorySub: '中餐厅' },
        { name: '校园便利店', categoryMain: '购物服务', categorySub: '便利店' },
      ],
      aoiContext: [
        { name: '湖北大学生活区', fclass: 'residential', population: 2800, areaSqm: 180000 },
        { name: '三角路地铁商业带', fclass: 'commercial', areaSqm: 64000 },
      ],
      landuseContext: [
        { landType: 'education', parcelCount: 3, totalAreaSqm: 93000 },
        { landType: 'residential', parcelCount: 6, totalAreaSqm: 86000 },
        { landType: 'commercial', parcelCount: 4, totalAreaSqm: 52000 },
      ],
      competitionDensity: [
        { label: '餐饮美食', count: 10, avgDistanceM: 135 },
      ],
    })

    expect(encoded.dimension).toBeGreaterThan(0)
    expect(encoded.feature_tags.map((item: { label: string }) => item.label)).toEqual(expect.arrayContaining([
      '校园主导',
      '居住商业混合',
      '餐饮竞争偏密',
    ]))
    expect(encoded.summary).toMatch(/湖北大学|校园|混合/)
    expect(encoded.tokens).toEqual(expect.arrayContaining([
      'feature:campus_anchor',
      'feature:mixed_use',
    ]))
  })

  it('reports degraded local status when no remote encoder is configured', async () => {
    const bridge = new RemoteFirstPythonBridge()

    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'local',
      ready: true,
      degraded: true,
      reason: 'remote_unconfigured',
    })
  })

  it('prefers the remote encoder when configured and reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        vector: [0.12, 0.88],
        tokens: ['武汉大学', '咖啡'],
        dimension: 2,
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const encoded = await bridge.encodeText('武汉大学附近咖啡店')

    expect(encoded).toEqual({
      vector: [0.12, 0.88],
      tokens: ['武汉大学', '咖啡'],
      dimension: 2,
    })
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://encoder.test',
    })
  })

  it('falls back to the local encoder when the remote request fails', async () => {
    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED')
      }),
      fallback: new LocalPythonBridge(),
    })

    const encoded = await bridge.encodeText('高校周边咖啡和夜间活跃')

    expect(encoded.dimension).toBeGreaterThan(0)
    expect(encoded.vector.length).toBe(encoded.dimension)
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'fallback',
      ready: true,
      degraded: true,
      reason: 'remote_request_failed',
    })
  })

  it('prefers the remote region snapshot encoder when configured and reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        vector: [0.33, 0.67],
        tokens: ['feature:campus_anchor', 'feature:mixed_use'],
        dimension: 2,
        summary: '校园主导、居住商业混合、热点围绕地铁口展开。',
        feature_tags: [
          { key: 'campus_anchor', label: '校园主导', score: 0.91 },
          { key: 'mixed_use', label: '居住商业混合', score: 0.86 },
        ],
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const encoded = await (bridge as any).encodeRegionSnapshot({
      subjectName: '湖北大学校园生活带',
      dominantCategories: [{ label: '餐饮美食', count: 14, share: 0.58 }],
    })

    expect(encoded).toMatchObject({
      vector: [0.33, 0.67],
      dimension: 2,
      summary: expect.stringMatching(/校园主导/),
      feature_tags: expect.arrayContaining([
        expect.objectContaining({ label: '校园主导' }),
      ]),
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/encode-region-snapshot$/),
      expect.any(Object),
    )
  })

  it('prefers the remote poi profile encoder when configured and reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        vector: [0.42, 0.58],
        tokens: ['feature:transit_gateway', 'feature:hotspot_anchor'],
        dimension: 2,
        summary: '湖北大学地铁站E口更像交通接驳点、热点锚点。',
        feature_tags: [
          { key: 'transit_gateway', label: '交通接驳点', score: 0.95 },
          { key: 'hotspot_anchor', label: '热点锚点', score: 0.82 },
        ],
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const encoded = await (bridge as any).encodePoiProfile({
      name: '湖北大学地铁站E口',
      categoryMain: '交通设施服务',
      categorySub: '地铁站',
    })

    expect(encoded).toMatchObject({
      vector: [0.42, 0.58],
      summary: expect.stringMatching(/交通接驳点/),
      feature_tags: expect.arrayContaining([
        expect.objectContaining({ label: '交通接驳点' }),
      ]),
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/encode-poi-profile$/),
      expect.any(Object),
    )
  })

  it('keeps the last fallback status for snapshot/profile style calls when the remote endpoint is missing', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      if (url.endsWith('/encode-region-snapshot')) {
        return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
      }

      return new Response(JSON.stringify({
        vector: [0.12, 0.88],
        tokens: ['武汉大学', '咖啡'],
        dimension: 2,
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const encoded = await bridge.encodeRegionSnapshot({
      subjectName: '湖北大学校园生活带',
      dominantCategories: [{ label: '餐饮美食', count: 10, share: 0.4 }],
    })

    expect(encoded.dimension).toBeGreaterThan(0)
    await expect(bridge.getStatus({ probe: false })).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'fallback',
      degraded: true,
      reason: 'remote_endpoint_unavailable',
      details: {
        path: '/encode-region-snapshot',
      },
    })
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      degraded: false,
      target: 'http://encoder.test',
    })
  })

  it('reads town cell context and nearby cell search from the remote encoder when available', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/cell/context')) {
        return new Response(JSON.stringify({
          context: {
            cell_id: '8840a69023fffff',
            dominant_category: '购物消费',
            region_name: '居住类',
          },
          models_used: ['town_encoder'],
        }), { status: 200 })
      }

      if (url.endsWith('/cell/search')) {
        return new Response(JSON.stringify({
          anchor_cell_context: {
            cell_id: '8840a69023fffff',
            dominant_category: '购物消费',
          },
          cells: [
            { cell_id: '8840a69023fffff', dominant_category: '购物消费', search_score: 0.9 },
            { cell_id: '8840a6903dfffff', dominant_category: '餐饮美食', search_score: 0.84 },
          ],
          model_route: 'town_encoder',
          models_used: ['town_encoder'],
          search_radius_m: 1600,
          per_cell_radius_m: 750,
          support_bucket_distribution: [{ bucket: '零售购物', count: 10 }],
          dominant_buckets: ['零售购物', '餐饮配套'],
          scene_tags: ['居住社区', '餐饮活跃'],
          cell_mix: [{ label: '居住类', count: 5, ratio: 1 }],
          macro_uncertainty: { consistency_score: 0.91 },
        }), { status: 200 })
      }

      return new Response(JSON.stringify({
        status: 'ok',
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const context = await bridge.getCellContext(114.398573, 30.505338)
    const search = await bridge.searchNearbyCells({
      anchorLon: 114.398573,
      anchorLat: 30.505338,
      userQuery: '光谷附近美食',
      taskType: 'nearby_poi',
      topK: 5,
    })

    expect(context).toMatchObject({
      context: {
        cell_id: '8840a69023fffff',
        dominant_category: '购物消费',
      },
      models_used: ['town_encoder'],
    })
    expect(search).toMatchObject({
      dominant_buckets: ['零售购物', '餐饮配套'],
      scene_tags: ['居住社区', '餐饮活跃'],
      search_radius_m: 1600,
      per_cell_radius_m: 750,
    })
    await expect(bridge.getStatus({ probe: false })).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      degraded: false,
      target: 'http://encoder.test',
    })
  })

  it('recovers health status after a transient remote encoder failure', async () => {
    let encodeAttempts = 0
    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }

        encodeAttempts += 1
        if (encodeAttempts === 1) {
          throw new Error('connect ECONNREFUSED')
        }

        return new Response(JSON.stringify({
          vector: [0.12, 0.88],
          tokens: ['武汉大学', '咖啡'],
          dimension: 2,
        }), { status: 200 })
      }),
      fallback: new LocalPythonBridge(),
    })

    const firstEncoded = await bridge.encodeText('武汉大学附近咖啡店')
    expect(firstEncoded.dimension).toBeGreaterThan(0)

    const recoveredStatus = await bridge.getStatus()
    expect(recoveredStatus).toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://encoder.test',
    })
  })
})
