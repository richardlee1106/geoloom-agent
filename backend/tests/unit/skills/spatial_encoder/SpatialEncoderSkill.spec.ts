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
  })
})
