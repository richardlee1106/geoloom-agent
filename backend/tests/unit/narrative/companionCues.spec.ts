import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider, LLMResponse } from '../../../src/llm/types.js'
import { buildNarrativeCompanionCues } from '../../../src/narrative/companionCues.js'
import type { NarrativeChapter, NarrativeRegion } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'

function createProvider(content: string): LLMProvider {
  return {
    getStatus: () => ({ ready: true, provider: 'test-provider', model: 'test-model', target: 'mock://llm' }),
    isReady: () => true,
    complete: vi.fn(async () => ({
      assistantMessage: { role: 'assistant', content, toolCalls: [] },
      toolCalls: [],
      finishReason: 'stop',
    } satisfies LLMResponse)),
  }
}

const chapter: NarrativeChapter = {
  region_id: 'jianghanguan',
  text: '江汉关大楼建于 1924 年，是汉口开埠后近代城市记忆里很醒目的地标。今天走到这里，很多人会把它和江汉路、汉口江滩一起串起来看。',
  web_sources: [{ title: '江汉关博物馆介绍', url: 'https://example.com', snippet: '江汉关大楼是武汉近代建筑代表之一。' }],
}

const region: NarrativeRegion = {
  id: 'jianghanguan',
  display_name: '江汉关',
  role: 'primary_region',
  core_anchor: { id: 'jianghanguan', lon: 114.29, lat: 30.58 },
  boundary: polygonFromBounds({ west: 114.28, south: 30.57, east: 114.3, north: 30.59 }),
  visual_layer: { mode: 'region_glow' },
  pois: [],
  narrative_facts: [
    {
      claim: '江汉关是汉口近代城市记忆中的地标。',
      source: 'web_verified',
      confidence: 0.9,
      verified: true,
      related_entity: { type: 'region', id: 'jianghanguan' },
    },
  ],
}

describe('buildNarrativeCompanionCues', () => {
  it('生成绑定原文章节点的追问候选，不提前生成答案', async () => {
    const provider = createProvider(JSON.stringify({
      cues: [
        {
          bubble_text: '想知道江汉关现在怎么预约参观吗？',
          prompt: '请查询江汉关博物馆现在的开放时间、预约方式、门票和参观注意事项。',
          kind: 'visit_info',
          target_entity: '江汉关',
          anchor_text: '江汉关大楼建于 1924 年',
          requires_web: true,
          priority: 0.93,
          display_after_ms: 900,
        },
      ],
    }))

    const result = await buildNarrativeCompanionCues({ chapter, region, llmProvider: provider })

    expect(result.debug.used).toBe(true)
    expect(result.cues).toHaveLength(1)
    expect(result.cues[0]).toMatchObject({
      region_id: 'jianghanguan',
      bubble_text: '想知道江汉关现在怎么预约参观吗？',
      anchor_text: '江汉关大楼建于 1924 年',
      requires_web: true,
    })
    expect(result.cues[0].prompt).toContain('开放时间')
  })

  it('过滤没有原文锚点或已经声称实时答案的候选', async () => {
    const provider = createProvider(JSON.stringify({
      cues: [
        {
          bubble_text: '想了解更多吗？',
          prompt: '继续讲讲。',
          kind: 'history_deep_dive',
          anchor_text: '不存在的锚点',
          requires_web: false,
          priority: 0.9,
        },
        {
          bubble_text: '江汉关今天九点开门吗？',
          prompt: '江汉关今天九点开门。',
          kind: 'visit_info',
          anchor_text: '江汉关大楼建于 1924 年',
          requires_web: true,
          priority: 0.9,
        },
      ],
    }))

    const result = await buildNarrativeCompanionCues({ chapter, region, llmProvider: provider })

    expect(result.cues).toHaveLength(0)
  })
})
