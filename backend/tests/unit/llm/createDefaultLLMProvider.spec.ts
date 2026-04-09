import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultLLMProvider } from '../../../src/llm/createDefaultLLMProvider.js'
import { AnthropicCompatibleProvider } from '../../../src/llm/AnthropicCompatibleProvider.js'
import { FailoverLLMProvider } from '../../../src/llm/FailoverLLMProvider.js'
import { OpenAICompatibleProvider } from '../../../src/llm/OpenAICompatibleProvider.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createDefaultLLMProvider', () => {
  it('selects the anthropic-compatible provider when protocol is anthropic', () => {
    vi.stubEnv('LLM_PROTOCOL', 'anthropic')
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')

    const provider = createDefaultLLMProvider()

    expect(provider).toBeInstanceOf(AnthropicCompatibleProvider)
  })

  it('selects the anthropic-compatible provider when the base url targets anthropic', () => {
    vi.stubEnv('LLM_PROTOCOL', '')
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')

    const provider = createDefaultLLMProvider()

    expect(provider).toBeInstanceOf(AnthropicCompatibleProvider)
  })

  it('keeps the openai-compatible provider for non-anthropic targets', () => {
    vi.stubEnv('LLM_PROTOCOL', 'openai')
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/v1')

    const provider = createDefaultLLMProvider()

    expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
  })

  it('wraps the primary provider with failover when fallback env is configured', () => {
    vi.stubEnv('LLM_PROTOCOL', 'anthropic')
    vi.stubEnv('LLM_BASE_URL', 'https://api.minimaxi.com/anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-primary')
    vi.stubEnv('LLM_MODEL', 'MiniMax-M2.7')
    vi.stubEnv('LLM_FALLBACK_PROTOCOL', 'anthropic')
    vi.stubEnv('LLM_FALLBACK_BASE_URL', 'https://qianfan.baidubce.com/anthropic/coding')
    vi.stubEnv('LLM_FALLBACK_API_KEY', 'sk-fallback')
    vi.stubEnv('LLM_FALLBACK_MODEL', 'qianfan-code-latest')

    const provider = createDefaultLLMProvider()

    expect(provider).toBeInstanceOf(FailoverLLMProvider)
  })
})
