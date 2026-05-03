import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js'
import type { NarrativeChapter, NarrativePoi } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { buildGraphNarration } from '../../../src/narrative/llmNarrator.js'
import type { PathSamplerResult } from '../../../src/narrative/pathSampler.js'
import type { RegionCandidate } from '../../../src/narrative/regionCandidate.js'

function createProvider(content: string): LLMProvider {
  return {
    getStatus: () => ({ ready: true, provider: 'test-provider', model: 'deepseek-v4-flash-search-nothinking', target: 'mock://llm' }),
    isReady: () => true,
    complete: vi.fn(async () => ({
      assistantMessage: { role: 'assistant', content, toolCalls: [] },
      toolCalls: [],
      finishReason: 'stop',
    } satisfies LLMResponse)),
  }
}

function candidate(id: string, name: string, categoryMain: string): RegionCandidate {
  const poi: NarrativePoi = {
    id: `poi-${id}`,
    lon: 114.34,
    lat: 30.54,
    display_name: `${name}支撑点`,
    tier: 'strong',
    role: 'scene_evidence',
    category_main: categoryMain,
  }
  return {
    id,
    display_name: name,
    role: 'primary_region',
    core_anchor: { id, lon: 114.34, lat: 30.54 },
    boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
    visual_layer: { mode: 'region_glow' },
    pois: [poi],
    narrative_facts: [
      {
        claim: `${name}在当前视野中有可用的真实地界。`,
        source: 'aoi_entity',
        confidence: 0.92,
        verified: true,
        related_entity: { type: 'region', id },
      },
    ],
    score: 0.9,
    source: 'aoi',
    coverage: 0.7,
    diversity: 0.4,
    effectivePoiCount: 1,
  }
}

const path: PathSamplerResult = {
  nodes: [
    { region_id: 'wuda', narration_role: 'core', transition_reason: '从当前视野中最有代表性的区域开始讲起。' },
    { region_id: 'east-lake', narration_role: 'ecological', transition_reason: '从武汉大学转到东湖风景区，能看到教育文化空间和开放生态空间之间的衔接。' },
  ],
  alternativesCount: 0,
  relations: [
    {
      from_region_id: 'wuda',
      to_region_id: 'east-lake',
      type: 'functional_complement',
      strength: 0.82,
      evidence: ['教育文化→生态休闲', '功能互补'],
    },
  ],
}

const chapters: NarrativeChapter[] = [
  { region_id: 'wuda', text: '先看武汉大学。这里有真实地界。' },
  { region_id: 'east-lake', text: '接着看东湖风景区。这里有生态空间。' },
]

describe('buildGraphNarration', () => {
  it('uses LLM output as narration while preserving chapter metadata and order', async () => {
    const provider = createProvider(JSON.stringify({
      chapters: [
        { region_id: 'wuda', text: '先看武汉大学，这一段先把视线落在校园和周边文化空间上。它在当前视野里承担开场作用，让人先理解这一带的教育文化底色。' },
        { region_id: 'east-lake', text: '接着转向东湖风景区，叙事从校园延伸到开放水岸和绿地。这个转场能把教育文化氛围与生态休闲空间自然接起来。' },
      ],
    }))

    const result = await buildGraphNarration({
      chapters,
      regions: [candidate('wuda', '武汉大学', '科教文化服务'), candidate('east-lake', '东湖风景区', '风景名胜')],
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext: { time_label: '下午', weather_label: '晴', preference_label: '游览', history_label: '首次进入' },
      llmProvider: provider,
    })

    expect(result.debug.used).toBe(true)
    expect(result.chapters.map((chapter) => chapter.region_id)).toEqual(['wuda', 'east-lake'])
    expect(result.chapters[1].text).toContain('教育文化氛围与生态休闲空间')
  })

  it('falls back when LLM changes the chapter contract', async () => {
    const provider = createProvider(JSON.stringify({ chapters: [{ region_id: 'east-lake', text: '错误顺序文本。' }] }))

    const result = await buildGraphNarration({
      chapters,
      regions: [candidate('wuda', '武汉大学', '科教文化服务'), candidate('east-lake', '东湖风景区', '风景名胜')],
      path,
      scene: 'education_culture',
      tone: 'tour',
      userContext: { time_label: '下午', weather_label: '晴', preference_label: '游览', history_label: '首次进入' },
      llmProvider: provider,
    })

    expect(result.debug).toMatchObject({ used: false, fallback_reason: 'invalid_llm_output' })
    expect(result.chapters).toBe(chapters)
  })
})
