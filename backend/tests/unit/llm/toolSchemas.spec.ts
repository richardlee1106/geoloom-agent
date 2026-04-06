import { describe, expect, it } from 'vitest'

import { buildToolSchemas } from '../../../src/llm/toolSchemaBuilder.js'
import type { SkillDefinition } from '../../../src/skills/types.js'

function createSkill(name: string, actions: string[]): SkillDefinition {
  return {
    name,
    description: `${name} skill`,
    capabilities: actions,
    actions: Object.fromEntries(actions.map((action) => [
      action,
      {
        name: action,
        description: `${action} description`,
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
    ])),
    async execute(action) {
      return {
        ok: true,
        data: { action },
        meta: {
          action,
          audited: false,
        },
      }
    },
  }
}

describe('buildToolSchemas', () => {
  it('builds one tool schema per runtime skill with manifest-driven action enums', () => {
    const tools = buildToolSchemas({
      skills: [
        createSkill('postgis', ['resolve_anchor', 'execute_spatial_sql']),
        createSkill('route_distance', ['get_route_distance']),
      ],
      manifests: [
        {
          name: 'postgis',
          runtimeSkill: 'postgis',
          description: '只读空间事实技能',
          actions: ['resolve_anchor', 'execute_spatial_sql'],
          capabilities: ['catalog'],
          promptSnippet: 'postgis prompt',
          path: '/tmp/postgis/SKILL.md',
        },
        {
          name: 'route_distance',
          runtimeSkill: 'route_distance',
          description: '路网距离技能',
          actions: ['get_route_distance'],
          capabilities: ['routing'],
          promptSnippet: 'route prompt',
          path: '/tmp/route/SKILL.md',
        },
      ],
    })

    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({
      name: 'postgis',
    })
    expect(tools[0]?.inputSchema?.properties?.action).toMatchObject({
      enum: ['resolve_anchor', 'execute_spatial_sql'],
    })
  })
})
