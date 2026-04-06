import { describe, expect, it, vi } from 'vitest'

import { runFunctionCallingLoop } from '../../../src/llm/FunctionCallingLoop.js'

describe('runFunctionCallingLoop', () => {
  it('replays the full assistant tool-call message back into history before the next round', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-model',
        target: 'https://example.test/v1',
      }),
      complete: vi.fn()
        .mockImplementationOnce(async ({ messages }) => {
          expect(messages).toHaveLength(2)
          expect(messages[0]).toMatchObject({ role: 'system' })
          expect(messages[1]).toMatchObject({ role: 'user', content: '武汉大学附近有哪些咖啡店？' })

          return {
            assistantMessage: {
              role: 'assistant',
              content: null,
              toolCalls: [
                {
                  id: 'call_resolve_anchor',
                  name: 'postgis',
                  arguments: {
                    action: 'resolve_anchor',
                    payload: {
                      place_name: '武汉大学',
                      role: 'primary',
                    },
                  },
                },
              ],
            },
            toolCalls: [
              {
                id: 'call_resolve_anchor',
                name: 'postgis',
                arguments: {
                  action: 'resolve_anchor',
                  payload: {
                    place_name: '武汉大学',
                    role: 'primary',
                  },
                },
              },
            ],
            finishReason: 'tool_calls' as const,
          }
        })
        .mockImplementationOnce(async ({ messages }) => {
          expect(messages).toHaveLength(4)
          expect(messages[2]).toMatchObject({
            role: 'assistant',
            toolCalls: [
              {
                id: 'call_resolve_anchor',
                name: 'postgis',
              },
            ],
          })
          expect(messages[3]).toMatchObject({
            role: 'tool',
            name: 'postgis',
            toolCallId: 'call_resolve_anchor',
          })

          return {
            assistantMessage: {
              role: 'assistant',
              content: '这是完整上下文下的大模型总结。',
              toolCalls: [],
            },
            toolCalls: [],
            finishReason: 'stop' as const,
          }
        }),
    }

    const result = await runFunctionCallingLoop({
      provider,
      tools: [],
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' },
      ],
      onToolCall: async () => ({
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
        trace: {
          id: 'call_resolve_anchor',
          skill: 'postgis',
          action: 'resolve_anchor',
          status: 'done',
          payload: {
            place_name: '武汉大学',
          },
        },
      }),
    })

    expect(provider.complete).toHaveBeenCalledTimes(2)
    expect(result.assistantMessage?.content).toBe('这是完整上下文下的大模型总结。')
    expect(result.traces).toHaveLength(1)
  })
})
