import { describe, expect, it } from 'vitest'

import { createSkillExecutionContext } from '../../../../src/skills/SkillContext.js'
import { createRouteDistanceSkill } from '../../../../src/skills/route_distance/RouteDistanceSkill.js'

describe('RouteDistanceSkill', () => {
  it('computes route distance for a single destination', async () => {
    const skill = createRouteDistanceSkill()

    const result = await skill.execute('get_route_distance', {
      origin: { type: 'Point', coordinates: [114.364339, 30.536334] },
      destination: { type: 'Point', coordinates: [114.355, 30.54] },
      mode: 'walking',
    }, createSkillExecutionContext())

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      mode: 'walking',
      distance_m: expect.any(Number),
      duration_min: expect.any(Number),
      degraded: expect.any(Boolean),
    })
  })

  it('ranks multiple destinations in ascending distance order', async () => {
    const skill = createRouteDistanceSkill()

    const result = await skill.execute('get_multi_destination_matrix', {
      origin: { type: 'Point', coordinates: [114.364339, 30.536334] },
      destinations: [
        { id: 'far', type: 'Point', coordinates: [114.39, 30.55] },
        { id: 'near', type: 'Point', coordinates: [114.365, 30.537] },
      ],
      mode: 'walking',
    }, createSkillExecutionContext())

    expect(result.ok).toBe(true)
    expect(result.data?.results[0]?.id).toBe('near')
    expect(result.data?.results[0]?.rank).toBe(1)
  })
})
