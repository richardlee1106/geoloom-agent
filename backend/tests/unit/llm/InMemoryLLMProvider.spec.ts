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
})
