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

  it('forwards request-level timeout hints to the provider', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-model',
      }),
      complete: vi.fn().mockResolvedValue({
        assistantMessage: {
          role: 'assistant',
          content: '完成',
          toolCalls: [],
        },
        toolCalls: [],
        finishReason: 'stop' as const,
      }),
    }

    await runFunctionCallingLoop({
      provider,
      tools: [],
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '请快速读懂当前区域' },
      ],
      requestTimeoutMs: 30000,
      onToolCall: async () => ({
        content: '{}',
        trace: {
          id: 'noop',
          skill: 'postgis',
          action: 'noop',
          status: 'done',
          payload: {},
        },
      }),
    })

    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 30000,
    }))
  })

  it('runs same-phase refinement tools in one parallel batch after evidence fetching completes', async () => {
    const provider = {
      isReady: () => true,
      getStatus: () => ({
        ready: true,
        provider: 'mock-openai-compatible',
        model: 'mock-model',
      }),
      complete: vi.fn()
        .mockResolvedValueOnce({
          assistantMessage: {
            role: 'assistant',
            content: null,
            toolCalls: [
              {
                id: 'call_histogram',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: { template: 'area_category_histogram' },
                },
              },
              {
                id: 'call_samples',
                name: 'postgis',
                arguments: {
                  action: 'execute_spatial_sql',
                  payload: { template: 'area_representative_sample' },
                },
              },
              {
                id: 'call_selector',
                name: 'semantic_selector',
                arguments: {
                  action: 'select_area_evidence',
                  payload: { raw_query: '总结一下这片区域的业态结构' },
                },
              },
              {
                id: 'call_encoder',
                name: 'spatial_encoder',
                arguments: {
                  action: 'encode_region_snapshot',
                  payload: { region_snapshot: { dominantCategories: [] } },
                },
              },
            ],
          },
          toolCalls: [
            {
              id: 'call_histogram',
              name: 'postgis',
              arguments: {
                action: 'execute_spatial_sql',
                payload: { template: 'area_category_histogram' },
              },
            },
            {
              id: 'call_samples',
              name: 'postgis',
              arguments: {
                action: 'execute_spatial_sql',
                payload: { template: 'area_representative_sample' },
              },
            },
            {
              id: 'call_selector',
              name: 'semantic_selector',
              arguments: {
                action: 'select_area_evidence',
                payload: { raw_query: '总结一下这片区域的业态结构' },
              },
            },
            {
              id: 'call_encoder',
              name: 'spatial_encoder',
              arguments: {
                action: 'encode_region_snapshot',
                payload: { region_snapshot: { dominantCategories: [] } },
              },
            },
          ],
          finishReason: 'tool_calls' as const,
        })
        .mockResolvedValueOnce({
          assistantMessage: {
            role: 'assistant',
            content: '完成',
            toolCalls: [],
          },
          toolCalls: [],
          finishReason: 'stop' as const,
        }),
    }

    const batches: string[][] = []
    await runFunctionCallingLoop({
      provider,
      tools: [],
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '总结一下这片区域的业态结构' },
      ],
      onToolCallBatch: async (calls) => {
        batches.push(calls.map((call) => call.id))
        return calls.map((call) => ({
          content: JSON.stringify({ ok: true, id: call.id }),
          trace: {
            id: call.id,
            skill: call.name,
            action: String(call.arguments.action || ''),
            status: 'done' as const,
            payload: call.arguments.payload as Record<string, unknown>,
          },
        }))
      },
      onToolCall: async () => {
        throw new Error('single-call executor should not run for batched calls')
      },
    })

    expect(batches).toEqual([
      ['call_histogram', 'call_samples'],
      ['call_selector', 'call_encoder'],
    ])
  })
})
