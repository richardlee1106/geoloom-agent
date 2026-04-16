import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpenAICompatibleProvider } from '../../../src/llm/OpenAICompatibleProvider.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('OpenAICompatibleProvider', () => {
  it('reports MiniMax target details in provider status', () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/v1')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')

    const provider = new OpenAICompatibleProvider()

    expect(provider.getStatus()).toMatchObject({
      ready: true,
      provider: 'minimax-openai-compatible',
      model: 'MiniMax-M2.7',
      target: 'https://api.minimaxi.com/v1',
    })
  })

  it('parses tool calls and preserves the assistant message payload', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/v1')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'tool_001',
                  function: {
                    name: 'postgis',
                    arguments: '{"action":"resolve_anchor","payload":{"place_name":"武汉大学","role":"primary"}}',
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as typeof fetch

    const provider = new OpenAICompatibleProvider()
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' },
      ],
      tools: [],
    })

    expect(result.assistantMessage).toMatchObject({
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          id: 'tool_001',
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
    })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.finishReason).toBe('tool_calls')
  })

  it('sanitizes malformed tool arguments returned by the MiniMax-compatible upstream', async () => {
    vi.stubEnv('LLM_BASE_URL', 'http://219.143.144.35:8281/v1')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7-highspeed')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'tool_001',
                  function: {
                    name: 'postgis',
                    arguments: '{}{"action":"resolve_anchor","payload":{"place_name":"武汉大学","role":"primary"}}',
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as typeof fetch

    const provider = new OpenAICompatibleProvider()
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' },
      ],
      tools: [],
    })

    expect(result.toolCalls).toEqual([
      {
        id: 'tool_001',
        name: 'postgis',
        arguments: {
          action: 'resolve_anchor',
          payload: {
            place_name: '武汉大学',
            role: 'primary',
          },
        },
      },
    ])
  })

  it('honors request-level timeout overrides for slower agent orchestration calls', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/v1')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')
    vi.stubEnv('LLM_TIMEOUT_MS', '5')

    globalThis.fetch = vi.fn((_, init) => new Promise((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          json: async () => ({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: '编排完成',
                  tool_calls: [],
                },
              },
            ],
          }),
        })
      }, 20)

      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      }, { once: true })
    })) as typeof fetch

    const provider = new OpenAICompatibleProvider()
    const result = await provider.complete({
      messages: [
        { role: 'user', content: '请快速读懂当前区域' },
      ],
      tools: [],
      timeoutMs: 50,
    })

    expect(result.finishReason).toBe('stop')
    expect(result.assistantMessage.content).toBe('编排完成')
  })

  it('does not send enable_thinking for astron direct-output upstreams', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'astron-code-latest')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: '直接输出',
              tool_calls: [],
            },
          },
        ],
      }),
    }) as typeof fetch

    const provider = new OpenAICompatibleProvider()
    await provider.complete({
      messages: [{ role: 'user', content: '请直接回答' }],
      tools: [],
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] || []
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    expect(body.model).toBe('astron-code-latest')
    expect(body).not.toHaveProperty('enable_thinking')
    expect(body).not.toHaveProperty('extra_body')
  })
})
