import { describe, expect, it } from 'vitest'

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
            feature_tags: [{ key: 'campus_anchor', label: '校园主导', score: 0.91 }],
          }
        },
        async encodePoiProfile() {
          return {
            vector: [0.2, 0.8],
            tokens: ['feature:daily_service_node'],
            dimension: 2,
            summary: '日常配套支点',
            feature_tags: [{ key: 'daily_service_node', label: '日常配套支点', score: 0.82 }],
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
})
