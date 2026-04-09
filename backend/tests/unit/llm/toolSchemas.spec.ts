import { describe, expect, it } from 'vitest'

import { buildToolSchemas } from '../../../src/llm/toolSchemaBuilder.js'
import { createPostgisSkill } from '../../../src/skills/postgis/PostGISSkill.js'
import type { SkillDefinition } from '../../../src/skills/types.js'

function createSkill(
  name: string,
  actions: string[],
  actionSchemas: Record<string, Record<string, unknown>> = {},
): SkillDefinition {
  return {
    name,
    description: `${name} skill`,
    capabilities: actions,
    actions: Object.fromEntries(actions.map((action) => [
      action,
      {
        name: action,
        description: `${action} description`,
        inputSchema: {
          type: 'object',
          properties: {},
          ...(actionSchemas[action] || {}),
        },
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

  it('keeps each action payload schema visible to the LLM instead of widening payload to any object', () => {
    const tools = buildToolSchemas({
      skills: [
        createSkill(
          'postgis',
          ['resolve_anchor', 'execute_spatial_sql'],
          {
            resolve_anchor: {
              required: ['place_name'],
              properties: {
                place_name: { type: 'string' },
              },
            },
            execute_spatial_sql: {
              required: ['template'],
              properties: {
                template: {
                  type: 'string',
                  enum: ['area_category_histogram'],
                },
              },
            },
          },
        ),
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
      ],
    })

    const postgisSchema = tools[0]?.inputSchema as Record<string, any>
    expect(Array.isArray(postgisSchema?.oneOf)).toBe(true)

    const actionVariants = postgisSchema.oneOf as Array<Record<string, any>>
    const resolveVariant = actionVariants.find((variant) => variant?.properties?.action?.enum?.[0] === 'resolve_anchor')
    const executeVariant = actionVariants.find((variant) => variant?.properties?.action?.enum?.[0] === 'execute_spatial_sql')

    expect(resolveVariant?.properties?.payload?.required).toContain('place_name')
    expect(resolveVariant?.properties?.payload?.properties?.place_name).toMatchObject({ type: 'string' })
    expect(executeVariant?.properties?.payload?.required).toContain('template')
    expect(executeVariant?.properties?.payload?.properties?.template?.enum).toContain('area_category_histogram')
  })

  it('publishes the template-first postgis contract that the live agent loop already expects', () => {
    const skill = createPostgisSkill({
      sandbox: {
        execute: async () => ({
          rows: [],
          meta: {},
          audit: {},
        }),
      } as any,
      query: async () => ({ rows: [], rowCount: 0 } as any),
      searchCandidates: async () => [],
    })

    const tools = buildToolSchemas({
      skills: [skill],
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
      ],
    })

    const postgisSchema = tools[0]?.inputSchema as Record<string, any>
    const actionVariants = (postgisSchema?.oneOf || []) as Array<Record<string, any>>
    const resolveVariant = actionVariants.find((variant) => variant?.properties?.action?.enum?.[0] === 'resolve_anchor')
    const executeVariant = actionVariants.find((variant) => variant?.properties?.action?.enum?.[0] === 'execute_spatial_sql')

    expect(resolveVariant?.properties?.payload?.properties?.anchor_text).toMatchObject({ type: 'string' })
    expect(resolveVariant?.properties?.payload?.properties?.anchor_name).toMatchObject({ type: 'string' })

    const executePayloadBranches = (executeVariant?.properties?.payload?.oneOf || []) as Array<Record<string, any>>
    const templateBranch = executePayloadBranches.find((branch) => branch?.required?.includes('template'))
    const sqlBranch = executePayloadBranches.find((branch) => branch?.required?.includes('sql'))

    expect(templateBranch?.properties?.template?.enum).toEqual(expect.arrayContaining([
      'nearby_poi',
      'nearest_station',
      'area_category_histogram',
      'area_aoi_context',
      'area_landuse_context',
    ]))
    expect(sqlBranch?.properties?.sql).toMatchObject({ type: 'string' })
  })
})
