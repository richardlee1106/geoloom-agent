import { AnthropicCompatibleProvider } from './AnthropicCompatibleProvider.js'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js'

function resolveProtocol() {
  const protocol = String(process.env.LLM_PROTOCOL || '').trim().toLowerCase()
  const baseUrl = String(process.env.LLM_BASE_URL || '').trim().toLowerCase()

  if (protocol) return protocol
  if (baseUrl.includes('/anthropic')) return 'anthropic'
  return 'openai'
}

export function createDefaultLLMProvider() {
  return resolveProtocol() === 'anthropic'
    ? new AnthropicCompatibleProvider()
    : new OpenAICompatibleProvider()
}
