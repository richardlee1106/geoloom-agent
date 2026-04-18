import { describe, expect, it } from 'vitest'

import { NarrativeRuntime } from '../../../src/narrative/NarrativeRuntime.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'
import { createLogger } from '../../../src/utils/logger.js'
import type { NarrativeNode, NarrativeViewport } from '../../../src/narrative/types.js'
import type { SkillDefinition } from '../../../src/skills/types.js'

function makeRuntime(searchResults: Array<Record<string, unknown>> = []) {
  const registry = new SkillRegistry()

  if (searchResults.length > 0) {
    const searchSkill: SkillDefinition = {
      name: 'tavily_search',
      description: 'test search',
      capabilities: ['search'],
      actions: {},
      async execute() {
        return {
          ok: true,
          data: { results: searchResults },
          meta: { action: 'search_web', audited: false },
        }
      },
    }
    registry.register(searchSkill)
  }

  return new NarrativeRuntime({
    registry,
    version: 'test',
    provider: {
      getStatus() {
        return { ready: false, model: null, provider: 'test' }
      },
      isReady() {
        return false
      },
      async complete() {
        throw new Error('not implemented')
      },
    },
  })
}

function makeNode(partial: Partial<NarrativeNode> & { id: string, name: string, role: string }): NarrativeNode {
  return {
    id: partial.id,
    name: partial.name,
    role: partial.role,
    roleLabel: partial.roleLabel || '区域代表',
    source: partial.source || 'aoi_context',
    center: partial.center || { lon: 114.38, lat: 30.58 },
    score: partial.score || 0.9,
    categoryMain: partial.categoryMain ?? null,
    categorySub: partial.categorySub ?? null,
    distanceM: partial.distanceM ?? null,
    tags: partial.tags || [partial.role],
    reasons: partial.reasons || ['测试节点'],
    hotness: partial.hotness || 'low',
    boundary: partial.boundary || null,
  }
}

const context = {
  traceId: 'test-trace',
  requestId: 'test-request',
  logger: createLogger({ scope: 'test' }),
}

describe('NarrativeRuntime private helpers', () => {
  it('视口门禁应保留节点原始边界，不把最终展示边界裁断', () => {
    const runtime = makeRuntime()
    const viewport: NarrativeViewport = {
      swLon: 114.30,
      swLat: 30.55,
      neLon: 114.40,
      neLat: 30.62,
    }
    const originalBoundary = {
      type: 'Polygon' as const,
      source: 'aoi_native' as const,
      coordinates: [[
        [114.38, 30.57],
        [114.50, 30.57],
        [114.50, 30.59],
        [114.38, 30.59],
        [114.38, 30.57],
      ]],
    }
    const node = makeNode({
      id: 'campus:whu',
      name: '武汉大学',
      role: 'campus_anchor',
      roleLabel: '高校锚点',
      boundary: originalBoundary,
    })

    const result = (runtime as any).enforceViewportBoundaryContract([node], viewport, context, 500) as NarrativeNode[]

    expect(result).toHaveLength(1)
    expect(result[0].boundary).toEqual(originalBoundary)
    const maxLon = Math.max(...((result[0].boundary!.coordinates as number[][][])[0].map((point) => Number(point[0]))))
    expect(maxLon).toBeGreaterThan(114.45)
  })

  it('网页事实补强应过滤 docx 这类文件名式来源', async () => {
    const runtime = makeRuntime([
      { title: '[DOC] 2、中南财经政法大学首义校区.docx', snippet: '' },
      { title: '武汉大学医学部', snippet: '武汉大学医学部是武汉大学重要的医学教学科研基地。' },
    ])
    const nodes = [makeNode({
      id: 'medical:whu-med',
      name: '武汉大学医学部',
      role: 'medical_anchor',
      roleLabel: '医疗配套',
    })]

    const result = await (runtime as any).enrichSelectedNodesWithWebFacts(nodes, {
      dominantScene: '高校',
      sceneMix: ['高校'],
      summarySentence: '测试摘要',
      featureTags: [],
      encoderSummary: null,
      encoderTags: [],
      sceneTags: ['高校'],
      dominantBuckets: [],
      requestedStyle: 'classic_must_see',
      requestedStyleLabel: '快速了解',
    }, context) as NarrativeNode[]

    expect(result[0].webFacts?.snippets[0]).toBe('武汉大学医学部是武汉大学重要的医学教学科研基地。')
    expect(result[0].webFacts?.snippets.join(' ')).not.toContain('.docx')
    expect(result[0].webFacts?.snippets.join(' ')).not.toContain('[DOC]')
  })
})
