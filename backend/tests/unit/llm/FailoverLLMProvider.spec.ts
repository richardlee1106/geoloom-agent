import { describe, expect, it, vi } from 'vitest'

import { FailoverLLMProvider } from '../../../src/llm/FailoverLLMProvider.js'
import type { LLMProvider } from '../../../src/llm/types.js'

function createProvider(options: {
  ready?: boolean
  provider?: string
  model?: string
  message?: string
  throws?: string
}) {
  const provider = {
    isReady: () => options.ready ?? true,
    getStatus: () => ({
      ready: options.ready ?? true,
      provider: options.provider || 'mock-provider',
      model: options.model || 'mock-model',
    }),
    complete: vi.fn(async () => {
      if (options.throws) {
        throw new Error(options.throws)
      }

      return {
        assistantMessage: {
          role: 'assistant' as const,
          content: options.message || 'ok',
          toolCalls: [],
        },
        toolCalls: [],
        finishReason: 'stop' as const,
      }
    }),
  } satisfies LLMProvider

  return provider
}

describe('FailoverLLMProvider', () => {
  it('uses the primary provider when it succeeds', async () => {
    const primary = createProvider({
      provider: 'primary',
      message: 'primary ok',
    })
    const fallback = createProvider({
      provider: 'fallback',
      message: 'fallback ok',
    })
    const provider = new FailoverLLMProvider({ primary, fallback })

    const response = await provider.complete({
      messages: [],
      tools: [],
    })

    expect(response.assistantMessage.content).toBe('primary ok')
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).not.toHaveBeenCalled()
  })

  it('falls back when the primary provider throws', async () => {
    const primary = createProvider({
      provider: 'primary',
      throws: 'primary failed',
    })
    const fallback = createProvider({
      provider: 'fallback',
      message: 'fallback ok',
    })
    const provider = new FailoverLLMProvider({ primary, fallback })

    const response = await provider.complete({
      messages: [],
      tools: [],
    })

    expect(response.assistantMessage.content).toBe('fallback ok')
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).toHaveBeenCalledTimes(1)
  })

  it('uses the fallback directly when the primary provider is not ready', async () => {
    const primary = createProvider({
      provider: 'primary',
      ready: false,
      message: 'primary not ready',
    })
    const fallback = createProvider({
      provider: 'fallback',
      message: 'fallback ok',
    })
    const provider = new FailoverLLMProvider({ primary, fallback })

    const response = await provider.complete({
      messages: [],
      tools: [],
    })

    expect(response.assistantMessage.content).toBe('fallback ok')
    expect(primary.complete).not.toHaveBeenCalled()
    expect(fallback.complete).toHaveBeenCalledTimes(1)
    expect(provider.getStatus().provider).toBe('fallback')
  })
})
