import { describe, expect, it } from 'vitest'

import { InMemoryLLMProvider } from '../../../src/llm/InMemoryLLMProvider.js'

describe('InMemoryLLMProvider', () => {
  it('asks to resolve the anchor first for nearby queries', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '武汉大学附近有哪些咖啡店？',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      name: 'postgis',
      arguments: {
        action: 'resolve_anchor',
        payload: {
          place_name: '武汉大学',
          role: 'primary',
        },
      },
    })
  })

  it('asks to execute a nearby-poi template after anchor resolution', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '武汉大学附近有哪些咖啡店？',
        },
        {
          role: 'tool',
          name: 'postgis',
          toolCallId: 'tool_001',
          content: JSON.stringify({
            anchor: {
              place_name: '武汉大学',
              display_name: '武汉大学',
              resolved_place_name: '武汉大学',
              lon: 114.364339,
              lat: 30.536334,
            },
            role: 'primary',
          }),
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      name: 'postgis',
      arguments: {
        action: 'execute_spatial_sql',
        payload: {
          template: 'nearby_poi',
          category_key: 'coffee',
        },
      },
    })
  })

  it('requests AOI and landuse templates for current-area semantic classification questions', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '请判断当前区域更像居住片区、商业片区还是混合片区，并说明依据。',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_aoi_context')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_landuse_context')
  })

  it('requests AOI and landuse templates for current-area summary questions so the model can explain semantics instead of only counting poi', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_aoi_context')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_landuse_context')
  })

  it('treats 解读一下这片区域 as an area-analysis query in fallback tool planning mode', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '解读一下这片区域',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_category_histogram')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_aoi_context')
  })

  it('strips area-analysis lead-ins before resolving explicit place anchors in fallback mode', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '解读一下武汉大学周边的业态结构',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      name: 'postgis',
      arguments: {
        action: 'resolve_anchor',
        payload: {
          place_name: '武汉大学',
          role: 'primary',
        },
      },
    })
  })

  it('classifies 解读一下这片区域 as area_overview in intent-classifier mode', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'system',
          content: '你是 GeoLoom V4 的意图理解器。你只能返回一个 JSON 对象，不能输出解释，不能调用 tools。',
        },
        {
          role: 'user',
          content: [
            '请先理解用户原问题，再判断应该进入哪条 GeoLoom 主链路。',
            'user_query: 解读一下这片区域',
            'router_hint: unsupported',
            'has_spatial_view: true',
            'has_user_location: false',
            'has_regions: false',
          ].join('\n'),
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('stop')
    const parsed = JSON.parse(String(result.assistantMessage.content || '{}'))
    expect(parsed).toMatchObject({
      queryType: 'area_overview',
      anchorSource: 'map_view',
      needsClarification: false,
      clarificationHint: null,
    })
  })

  it('requests AOI and landuse templates for store-opportunity questions so opportunity reasoning can reference demand context', async () => {
    const provider = new InMemoryLLMProvider()

    const result = await provider.complete({
      messages: [
        {
          role: 'user',
          content: '如果要在当前区域开店，哪些业态更值得优先考虑？请结合周边供给、需求和竞争关系说明理由。',
        },
      ],
      tools: [],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_aoi_context')
    expect(result.toolCalls.map((call) => (call.arguments.payload as Record<string, unknown>).template)).toContain('area_landuse_context')
  })
})
