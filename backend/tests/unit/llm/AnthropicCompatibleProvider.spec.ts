import { afterEach, describe, expect, it, vi } from 'vitest'

import { AnthropicCompatibleProvider } from '../../../src/llm/AnthropicCompatibleProvider.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('AnthropicCompatibleProvider', () => {
  it('reports MiniMax anthropic target details in provider status', () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')

    const provider = new AnthropicCompatibleProvider()

    expect(provider.getStatus()).toMatchObject({
      ready: true,
      provider: 'minimax-anthropic-compatible',
      model: 'MiniMax-M2.7',
      target: 'https://api.minimaxi.com/anthropic',
    })
  })

  it('parses anthropic content blocks into assistant text and tool calls', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg_001',
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'thinking',
            thinking: '先解析锚点，再执行空间查询。',
          },
          {
            type: 'tool_use',
            id: 'toolu_001',
            name: 'postgis',
            input: {
              action: 'resolve_anchor',
              payload: {
                place_name: '武汉大学',
                role: 'primary',
              },
            },
          },
          {
            type: 'text',
            text: '我先定位武汉大学，然后继续执行查询。',
          },
        ],
      }),
    }) as typeof fetch

    const provider = new AnthropicCompatibleProvider()
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '武汉大学附近有哪些咖啡店？' },
      ],
      tools: [
        {
          name: 'postgis',
          description: '空间查询技能',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })

    expect(result.assistantMessage).toMatchObject({
      role: 'assistant',
      content: '我先定位武汉大学，然后继续执行查询。',
      toolCalls: [
        {
          id: 'toolu_001',
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
    expect(result.assistantMessage.contentBlocks).toHaveLength(3)
    expect(result.finishReason).toBe('tool_calls')
  })

  it('clamps oversized max_tokens before sending the upstream request', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')
    vi.stubEnv('LLM_MAX_TOKENS', '200000')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg_002',
        role: 'assistant',
        stop_reason: 'stop',
        content: [
          {
            type: 'text',
            text: '请求已完成。',
          },
        ],
      }),
    }) as typeof fetch

    const provider = new AnthropicCompatibleProvider()

    await provider.complete({
      messages: [
        { role: 'user', content: '请快速读懂当前区域' },
      ],
      tools: [],
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0]
    const payload = JSON.parse(String(requestInit?.body || '{}'))

    expect(payload.max_tokens).toBe(8192)
  })

  it('honors request-level timeout overrides for slower agent orchestration calls', async () => {
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-test')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')
    vi.stubEnv('LLM_TIMEOUT_MS', '5')

    globalThis.fetch = vi.fn((_, init) => new Promise((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          json: async () => ({
            id: 'msg_003',
            role: 'assistant',
            stop_reason: 'stop',
            content: [
              {
                type: 'text',
                text: '编排完成。',
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

    const provider = new AnthropicCompatibleProvider()
    const result = await provider.complete({
      messages: [
        { role: 'user', content: '请快速读懂当前区域' },
      ],
      tools: [],
      timeoutMs: 50,
    })

    expect(result.finishReason).toBe('stop')
    expect(result.assistantMessage.content).toBe('编排完成。')
  })
})
