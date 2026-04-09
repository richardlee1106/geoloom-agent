import { AnthropicCompatibleProvider } from './AnthropicCompatibleProvider.js'
import { FailoverLLMProvider } from './FailoverLLMProvider.js'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js'

function readEnv(key: string, fallbackKey?: string) {
  const specific = String(process.env[key] || '').trim()
  if (specific) return specific
  if (!fallbackKey) return ''
  return String(process.env[fallbackKey] || '').trim()
}

function resolveProtocol(prefix = 'LLM') {
  const protocol = String(process.env[`${prefix}_PROTOCOL`] || '').trim().toLowerCase()
  const baseUrl = String(process.env[`${prefix}_BASE_URL`] || '').trim().toLowerCase()

  if (protocol) return protocol
  if (baseUrl.includes('/anthropic')) return 'anthropic'
  return 'openai'
}

function createProviderFromPrefix(prefix = 'LLM') {
  const protocol = resolveProtocol(prefix)
  const sharedTimeout = readEnv(`${prefix}_TIMEOUT_MS`, 'LLM_TIMEOUT_MS')

  if (protocol === 'anthropic') {
    return new AnthropicCompatibleProvider({
      baseUrl: readEnv(`${prefix}_BASE_URL`),
      apiKey: readEnv(`${prefix}_API_KEY`),
      model: readEnv(`${prefix}_MODEL`),
      timeoutMs: sharedTimeout,
      apiVersion: readEnv(`${prefix}_ANTHROPIC_VERSION`, 'LLM_ANTHROPIC_VERSION'),
      maxTokens: readEnv(`${prefix}_MAX_TOKENS`, 'LLM_MAX_TOKENS'),
    })
  }

  return new OpenAICompatibleProvider({
    baseUrl: readEnv(`${prefix}_BASE_URL`),
    apiKey: readEnv(`${prefix}_API_KEY`),
    model: readEnv(`${prefix}_MODEL`),
    timeoutMs: sharedTimeout,
  })
}

export function createDefaultLLMProvider() {
  const primary = createProviderFromPrefix('LLM')
  const fallback = createProviderFromPrefix('LLM_FALLBACK')

  if (!fallback.isReady()) {
    return primary
  }

  return new FailoverLLMProvider({
    primary,
    fallback,
  })
}
