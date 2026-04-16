import { describe, expect, it, vi } from 'vitest'

import { createSkillExecutionContext } from '../../../../src/skills/SkillContext.js'
import { createSpatialEncoderSkill } from '../../../../src/skills/spatial_encoder/SpatialEncoderSkill.js'

describe('SpatialEncoderSkill', () => {
  it('encodes query text into a reusable vector reference', async () => {
    const skill = createSpatialEncoderSkill()

    const result = await skill.execute(
      'encode_query',
      { text: '适合学生消费、交通便利、夜间活跃的片区' },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      vector_dim: expect.any(Number),
      vector_ref: expect.stringMatching(/^vector:query:/),
      semantic_evidence: {
        level: 'degraded',
        weakEvidence: true,
      },
    })
  })

  it('marks semantic evidence as available when the remote encoder is ready', async () => {
    const skill = createSpatialEncoderSkill({
      bridge: {
        async encodeText() {
          return {
            vector: [0.1, 0.9],
            tokens: ['武汉大学', '咖啡'],
            dimension: 2,
          }
        },
        async encodeRegionSnapshot() {
          return {
            vector: [0.1, 0.9],
            tokens: ['feature:campus_anchor'],
            dimension: 2,
            summary: '校园主导',
            feature_tags: [{ key: 'campus_anchor', label: '校园主导', score: 0.91, detail: null }],
          }
        },
        async encodePoiProfile() {
          return {
            vector: [0.2, 0.8],
            tokens: ['feature:daily_service_node'],
            dimension: 2,
            summary: '日常配套支点',
            feature_tags: [{ key: 'daily_service_node', label: '日常配套支点', score: 0.82, detail: null }],
          }
        },
        async getCellContext() {
          return {
            context: {
              cell_id: '8840a69023fffff',
              dominant_category: '餐饮美食',
            },
            models_used: ['town_encoder'],
          }
        },
        async searchNearbyCells() {
          return {
            anchor_cell_context: {
              cell_id: '8840a69023fffff',
              dominant_category: '餐饮美食',
            },
            cells: [],
            model_route: 'town_encoder',
            models_used: ['town_encoder'],
            search_radius_m: 1600,
            per_cell_radius_m: 750,
            support_bucket_distribution: [],
            dominant_buckets: ['餐饮配套'],
            scene_tags: ['餐饮活跃'],
            cell_mix: [],
            macro_uncertainty: {},
          }
        },
        async batchPoiCellContext(input) {
          return {
            anchor_cell_context: {
              cell_id: '8840a69023fffff',
              dominant_category: '餐饮美食',
            },
            results: (input.pois || []).map((poi, index) => ({
              ...poi,
              original_index: index,
              cell_context: {
                cell_id: `cell_${index + 1}`,
                dominant_category: '餐饮美食',
              },
            })),
            model_route: 'town_encoder',
            models_used: ['town_encoder'],
          }
        },
        async getStatus() {
          return {
            name: 'spatial_encoder',
            ready: true,
            mode: 'remote',
            degraded: false,
            reason: null,
            target: 'http://encoder.test',
          }
        },
      },
    })

    const result = await skill.execute(
      'encode_query',
      { text: '适合学生消费、交通便利、夜间活跃的片区' },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.semantic_evidence).toMatchObject({
      level: 'available',
      weakEvidence: false,
      mode: 'remote',
      target: 'http://encoder.test',
    })
  })

  it('reports the last operation status instead of re-probing health after a snapshot fallback', async () => {
    const getStatus = vi.fn(async (options?: { probe?: boolean }) => {
      if (options?.probe === false) {
        return {
          name: 'spatial_encoder',
          ready: true,
          mode: 'fallback' as const,
          degraded: true,
          reason: 'remote_endpoint_unavailable',
          target: 'http://encoder.test',
        }
      }

      return {
        name: 'spatial_encoder',
        ready: true,
        mode: 'remote' as const,
        degraded: false,
        reason: null,
        target: 'http://encoder.test',
      }
    })

    const skill = createSpatialEncoderSkill({
      bridge: {
        async encodeText() {
          return {
            vector: [0.1, 0.9],
            tokens: ['武汉大学'],
            dimension: 2,
          }
        },
        async encodeRegionSnapshot() {
          return {
            vector: [0.4, 0.6],
            tokens: ['feature:mixed_use'],
            dimension: 2,
            summary: '回退到本地快照编码',
            feature_tags: [{ key: 'mixed_use', label: '居住商业混合', score: 0.8, detail: null }],
          }
        },
        async encodePoiProfile() {
          return {
            vector: [0.2, 0.8],
            tokens: ['feature:daily_service_node'],
            dimension: 2,
            summary: '日常配套支点',
            feature_tags: [{ key: 'daily_service_node', label: '日常配套支点', score: 0.82, detail: null }],
          }
        },
        async getCellContext() {
          return {
            context: {},
            models_used: ['town_encoder'],
          }
        },
        async searchNearbyCells() {
          return {
            anchor_cell_context: {},
            cells: [],
            model_route: 'town_encoder',
            models_used: ['town_encoder'],
            search_radius_m: 1600,
            per_cell_radius_m: 750,
            support_bucket_distribution: [],
            dominant_buckets: [],
            scene_tags: [],
            cell_mix: [],
            macro_uncertainty: {},
          }
        },
        async batchPoiCellContext() {
          return {
            anchor_cell_context: {},
            results: [],
            model_route: 'town_encoder',
            models_used: ['town_encoder'],
          }
        },
        getStatus,
      },
    })

    const result = await skill.execute(
      'encode_region_snapshot',
      {
        snapshot: {
          subjectName: '光谷片区',
          dominantCategories: [{ label: '餐饮美食', count: 12, share: 0.4 }],
        },
      },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.semantic_evidence).toMatchObject({
      level: 'degraded',
      mode: 'fallback',
      reason: 'remote_endpoint_unavailable',
    })
    expect(getStatus).toHaveBeenCalledWith({ probe: false })
  })

  it('scores similarity between encoded candidates', async () => {
    const skill = createSpatialEncoderSkill()
    const context = createSkillExecutionContext()
    const query = await skill.execute('encode_query', { text: '高校周边咖啡和夜生活' }, context)
    const regionA = await skill.execute('encode_region', { label: '武大商圈，高校和咖啡密集' }, context)
    const regionB = await skill.execute('encode_region', { label: '远郊仓储园区' }, context)

    const score = await skill.execute('score_similarity', {
      query_vector_ref: query.data?.vector_ref,
      candidate_vector_refs: [regionA.data?.vector_ref, regionB.data?.vector_ref],
    }, context)

    expect(score.ok).toBe(true)
    expect(score.data?.scores[0]?.score).toBeGreaterThan(score.data?.scores[1]?.score ?? 0)
    expect(score.data?.semantic_evidence?.level).toBe('degraded')
  })

  it('encodes structured region snapshots into reusable vectors with feature tags', async () => {
    const skill = createSpatialEncoderSkill()

    const result = await skill.execute(
      'encode_region_snapshot',
      {
        snapshot: {
          subjectName: '湖北大学校园生活带',
          dominantCategories: [
            { label: '餐饮美食', count: 14, share: 0.58 },
            { label: '购物服务', count: 6, share: 0.25 },
          ],
          hotspots: [
            { label: '湖北大学地铁站E口、武昌鱼馆一带', poiCount: 9 },
          ],
          aoiContext: [
            { name: '湖北大学生活区', fclass: 'residential', areaSqm: 180000 },
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
        },
      },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      vector_dim: expect.any(Number),
      vector_ref: expect.stringMatching(/^vector:region:/),
      feature_summary: expect.stringMatching(/校园|混合/),
      feature_tags: expect.arrayContaining([
        expect.objectContaining({ label: '校园主导' }),
      ]),
      semantic_evidence: {
        level: 'degraded',
        weakEvidence: true,
      },
    })
  })

  it('encodes representative poi profiles into reusable vectors with role tags', async () => {
    const skill = createSpatialEncoderSkill()

    const result = await skill.execute(
      'encode_poi_profile',
      {
        profile: {
          name: '校园便利店',
          categoryMain: '购物服务',
          categorySub: '便利店',
          distanceM: 180,
          areaSubject: '湖北大学校园生活带',
          hotspotLabel: '湖北大学地铁站E口、武昌鱼馆一带',
          surroundingCategories: ['餐饮美食', '购物服务', '交通设施服务'],
          aoiContext: [
            { name: '湖北大学生活区', fclass: 'residential', areaSqm: 180000 },
          ],
        },
      },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      vector_dim: expect.any(Number),
      vector_ref: expect.stringMatching(/^vector:poi:/),
      feature_summary: expect.stringMatching(/校园便利店/),
      feature_tags: expect.arrayContaining([
        expect.objectContaining({ label: '日常配套支点' }),
      ]),
      semantic_evidence: {
        level: 'degraded',
        weakEvidence: true,
      },
    })
  })

  it('surfaces anchor cell macro semantics through search_anchor_cells', async () => {
    const skill = createSpatialEncoderSkill({
      bridge: {
        async encodeText() {
          return {
            vector: [0.1, 0.9],
            tokens: ['光谷'],
            dimension: 2,
          }
        },
        async encodeRegionSnapshot() {
          return {
            vector: [0.1, 0.9],
            tokens: ['feature:mixed_use'],
            dimension: 2,
            summary: '混合场景',
            feature_tags: [],
          }
        },
        async encodePoiProfile() {
          return {
            vector: [0.2, 0.8],
            tokens: ['feature:daily_service_node'],
            dimension: 2,
            summary: '日常配套支点',
            feature_tags: [],
          }
        },
        async getCellContext() {
          return {
            context: {
              cell_id: '8840a69023fffff',
              dominant_category: '购物消费',
            },
            models_used: ['town_encoder'],
          }
        },
        async searchNearbyCells() {
          return {
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
            support_bucket_distribution: [
              { bucket: '零售购物', count: 10 },
              { bucket: '餐饮配套', count: 3 },
            ],
            dominant_buckets: ['零售购物', '餐饮配套'],
            scene_tags: ['居住社区', '餐饮活跃'],
            cell_mix: [{ label: '居住类', count: 5, ratio: 1 }],
            macro_uncertainty: { consistency_score: 0.91 },
          }
        },
        async batchPoiCellContext() {
          return {
            anchor_cell_context: {},
            results: [],
            model_route: 'town_encoder',
            models_used: ['town_encoder'],
          }
        },
        async getStatus() {
          return {
            name: 'spatial_encoder',
            ready: true,
            mode: 'remote',
            degraded: false,
            reason: null,
            target: 'http://encoder.test',
          }
        },
      },
    })

    const result = await skill.execute(
      'search_anchor_cells',
      {
        anchor_lon: 114.398573,
        anchor_lat: 30.505338,
        user_query: '光谷附近美食',
        task_type: 'nearby_poi',
        top_k: 5,
      },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      dominant_buckets: ['零售购物', '餐饮配套'],
      scene_tags: ['居住社区', '餐饮活跃'],
      semantic_evidence: {
        level: 'available',
        mode: 'remote',
      },
    })
  })
})
