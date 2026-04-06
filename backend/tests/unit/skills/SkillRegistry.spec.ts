import { describe, expect, it } from 'vitest'

import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'
import type { SkillDefinition } from '../../../src/skills/types.js'

function createMockSkill(name = 'postgis'): SkillDefinition {
  return {
    name,
    description: 'mock skill',
    capabilities: ['query'],
    actions: {
      ping: {
        name: 'ping',
        description: 'ping',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    },
    async execute(action) {
      return {
        ok: action === 'ping',
        data: { ok: true },
        meta: { action, audited: false },
      }
    },
  }
}

describe('SkillRegistry', () => {
  it('registers and retrieves a skill by name', () => {
    const registry = new SkillRegistry()
    const skill = createMockSkill()

    registry.register(skill)

    expect(registry.get('postgis')).toBe(skill)
  })

  it('throws when registering the same skill twice', () => {
    const registry = new SkillRegistry()
    const skill = createMockSkill()
    registry.register(skill)

    expect(() => registry.register(skill)).toThrow(/already registered/i)
  })

  it('returns null for missing skills', () => {
    const registry = new SkillRegistry()

    expect(registry.get('missing')).toBeNull()
  })

  it('lists registered skills and their action summaries', () => {
    const registry = new SkillRegistry()
    registry.register(createMockSkill())

    const summaries = registry.list()

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      name: 'postgis',
      description: 'mock skill',
      capabilities: ['query'],
    })
    expect(summaries[0].actions[0]).toMatchObject({
      name: 'ping',
      description: 'ping',
    })
  })
})

