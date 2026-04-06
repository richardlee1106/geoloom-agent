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
  })
})
