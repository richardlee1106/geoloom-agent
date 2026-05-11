import { describe, expect, it, vi } from 'vitest'

import type { LLMProvider } from '../../../src/llm/types.js'
import { NarrativeAssistantService } from '../../../src/narrative/NarrativeAssistantService.js'
import type { NarrativeResponse } from '../../../src/narrative/contract.js'

function response(): NarrativeResponse {
  return {
    session_id: 'assistant-session',
    state_version: 3,
    scene_profile: 'commercial_leisure',
    lod: 'meso',
    viewport: { west: 114.3, south: 30.5, east: 114.4, north: 30.6, zoom: 14, center: [114.35, 30.55] },
    dominant_coverage: 0.7,
    candidate_count: 2,
    poi_density: 20,
    semantic_diversity: 0.6,
    regions: [
      {
        id: 'xudong',
        display_name: '徐东商圈',
        role: 'primary_region',
        core_anchor: { id: 'xudong-anchor', lon: 114.34, lat: 30.58 },
        boundary: { type: 'Polygon', coordinates: [[]] },
        visual_layer: { mode: 'poi_heat', poi_heat: { radius: 24, points: [] } },
        pois: [],
        business_profile: {
          sample_size: 8,
          dominant_main_types: [{ name: '购物服务', count: 4, share: 0.5 }],
          dominant_sub_types: [{ name: '商场', count: 3, share: 0.375 }],
          representative_places: ['销品茂', '武昌万象城'],
          summary_hint: '商业消费点较集中。',
          confidence: 'high',
        },
        narrative_facts: [
          { claim: '片区内有多个购物和餐饮点位支撑。', source: 'postgis', confidence: 0.9, verified: true, related_entity: { type: 'region', id: 'xudong' } },
        ],
      },
      {
        id: 'hubei-university',
        display_name: '湖北大学',
        role: 'support_region',
        core_anchor: { id: 'hubu-anchor', lon: 114.33, lat: 30.57 },
        boundary: { type: 'Polygon', coordinates: [[]] },
        visual_layer: { mode: 'poi_heat', poi_heat: { radius: 24, points: [] } },
        pois: [],
        narrative_facts: [
          { claim: '高校与周边商业形成生活支撑关系。', source: 'postgis', confidence: 0.8, verified: true, related_entity: { type: 'region', id: 'hubei-university' } },
        ],
      },
    ],
    path: {
      nodes: [
        { region_id: 'xudong', narration_role: 'core', transition_reason: '先从商业核心建立参照。' },
        { region_id: 'hubei-university', narration_role: 'educational', transition_reason: '再转向附近高校生活圈。' },
      ],
      seed: 'assistant-seed',
      alternatives_count: 0,
    },
    narration: {
      tone: 'tour',
      chapters: [
        {
          region_id: 'xudong',
          text: '徐东商圈这一段先从销品茂和武昌万象城讲起，再看餐饮和日常消费怎样围成片区。',
          web_sources: [
            { title: '徐东商圈介绍', url: 'https://example.com/xudong', snippet: '徐东商圈是武汉重要商业片区。' },
          ],
        },
        { region_id: 'hubei-university', text: '湖北大学这一段主要看校园和周边生活服务的关系。' },
      ],
    },
    user_context: { time_label: '当前时段', weather_label: '未指定', preference_label: '通用解说', history_label: '首次进入' },
  }
}

function request(message: string) {
  return {
    session_id: 'assistant-session',
    state_version: 3,
    message,
    client_state: {
      active_chapter_index: 0,
      playing: true,
      visible_region_ids: ['xudong', 'hubei-university'],
    },
    narrative_state: response(),
  }
}

function provider(content: string): LLMProvider {
  return {
    getStatus: () => ({ ready: true, provider: 'test', model: 'test-model' }),
    isReady: () => true,
    complete: vi.fn(async () => ({
      assistantMessage: { role: 'assistant' as const, content, toolCalls: [] },
      toolCalls: [],
      finishReason: 'stop' as const,
    })),
  }
}

describe('NarrativeAssistantService', () => {
  it('answers source questions from current chapter web sources', async () => {
    const service = new NarrativeAssistantService()

    const answer = await service.answer(request('这章有哪些网页来源？'))

    expect(answer.text).toContain('徐东商圈介绍')
    expect(answer.citations.some((citation) => citation.kind === 'web')).toBe(true)
  })

  it('returns safe UI actions for playback control', async () => {
    const service = new NarrativeAssistantService()

    const answer = await service.answer(request('跳到下一章'))

    expect(answer.ui_actions).toEqual([
      { action: 'jump_to_chapter', params: { index: 1 }, reason: '用户要求跳到下一站' },
    ])
  })

  it('uses LLM text when available while keeping deterministic actions and citations', async () => {
    const llm = provider(JSON.stringify({ text: '徐东这边可以先看商业核心，再看它怎么服务周边校园生活。', follow_up_suggestions: ['继续讲湖北大学'] }))
    const service = new NarrativeAssistantService({ llmProvider: llm })

    const answer = await service.answer(request('为什么先讲这里？'))

    expect(answer.text).toContain('徐东这边')
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.follow_up_suggestions).toEqual(['继续讲湖北大学'])
  })
})
