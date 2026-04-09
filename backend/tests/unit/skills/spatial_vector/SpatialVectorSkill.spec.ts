import { describe, expect, it } from 'vitest'

import { createSkillExecutionContext } from '../../../../src/skills/SkillContext.js'
import { createSpatialVectorSkill } from '../../../../src/skills/spatial_vector/SpatialVectorSkill.js'

describe('SpatialVectorSkill', () => {
  it('returns semantic poi candidates for descriptive search text', async () => {
    const skill = createSpatialVectorSkill()

    const result = await skill.execute(
      'search_semantic_pois',
      { text: '适合学生社交、轻消费、靠近高校的咖啡店', top_k: 3 },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.candidates.length).toBeGreaterThan(0)
    expect(result.data?.candidates[0]).toMatchObject({
      name: expect.any(String),
      score: expect.any(Number),
    })
    expect(result.data?.semantic_evidence).toMatchObject({
      level: 'degraded',
      weakEvidence: true,
    })
  })

  it('returns similar regions ordered by semantic score', async () => {
    const skill = createSpatialVectorSkill()

    const result = await skill.execute(
      'search_similar_regions',
      { text: '和武汉大学周边气质相似的片区', top_k: 3 },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.regions.length).toBeGreaterThan(0)
    expect(result.data?.regions[0]?.score).toBeGreaterThanOrEqual(result.data?.regions[1]?.score ?? 0)
    expect(result.data?.semantic_evidence?.level).toBe('degraded')
  })

  it('marks semantic vector evidence as available when the remote index is ready', async () => {
    const skill = createSpatialVectorSkill({
      index: {
        async searchSemanticPOIs() {
          return [
            { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
          ]
        },
        async searchSimilarRegions() {
          return [
            { id: 'region_remote_001', name: '远程商圈', summary: '远程相似片区', score: 0.93 },
          ]
        },
        async getStatus() {
          return {
            name: 'spatial_vector',
            ready: true,
            mode: 'remote',
            degraded: false,
            reason: null,
            target: 'http://vector.test',
          }
        },
      },
    })

    const result = await skill.execute(
      'search_similar_regions',
      { text: '和武汉大学周边气质相似的片区', top_k: 3 },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.semantic_evidence).toMatchObject({
      level: 'available',
      weakEvidence: false,
      mode: 'remote',
      target: 'http://vector.test',
    })
  })
})
