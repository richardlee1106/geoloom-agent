import { randomUUID } from 'node:crypto'

import type {
  LLMCompletionRequest,
  LLMContentBlock,
  LLMAssistantMessage,
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from './types.js'

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 2048
const MAX_SAFE_OUTPUT_TOKENS = 8192

interface ProviderMessage {
  role: 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

function normalizeMessagesEndpoint(baseUrl: string) {
  const trimmed = String(baseUrl || '').trim().replace(/\/$/, '')
  if (!trimmed) return ''
  if (/\/v1\/messages$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function normalizeToolInput(input: unknown) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }

  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as Record<string, unknown>
    } catch {
      return {
        raw_input: input,
      }
    }
  }

  return {}
}

function toToolDefinitions(request: LLMCompletionRequest) {
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

function asTextBlock(text: string) {
  return {
    type: 'text',
    text,
  }
}

function clampMaxTokens(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_MAX_TOKENS
  }

  return Math.min(Math.max(Math.round(numeric), 256), MAX_SAFE_OUTPUT_TOKENS)
}

function toAssistantBlocks(message: LLMMessage) {
  const blocks: Array<Record<string, unknown>> = []

  if (Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0) {
    return message.contentBlocks.map((block) => ({ ...block }))
  }

  if (message.content) {
    blocks.push(asTextBlock(message.content))
  }

  if (Array.isArray(message.toolCalls)) {
    for (const toolCall of message.toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: toolCall.id || randomUUID(),
        name: toolCall.name,
        input: toolCall.arguments || {},
      })
    }
  }

  return blocks.length > 0 ? blocks : ''
}

function toProviderMessages(request: LLMCompletionRequest) {
  const providerMessages: ProviderMessage[] = []

  for (const message of request.messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      providerMessages.push({
        role: 'user',
        content: message.content ? message.content : '',
      })
      continue
    }

    if (message.role === 'assistant') {
      providerMessages.push({
        role: 'assistant',
        content: toAssistantBlocks(message),
      })
      continue
    }

    providerMessages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId || randomUUID(),
          content: message.content || '',
        },
      ],
    })
  }

  return providerMessages
}

function toSystemPrompt(request: LLMCompletionRequest) {
  return request.messages
    .filter((message) => message.role === 'system' && message.content)
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
}

function normalizeAssistantContent(blocks: LLMContentBlock[]) {
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
    .trim()

  return text || null
}

function extractToolCalls(blocks: LLMContentBlock[]) {
  return blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: String(block.id || randomUUID()),
      name: String(block.name || ''),
      arguments: normalizeToolInput(block.input),
    }))
}

export class AnthropicCompatibleProvider implements LLMProvider {
  private readonly baseUrl = String(process.env.LLM_BASE_URL || '').trim()
  private readonly apiKey = String(process.env.LLM_API_KEY || '').trim()
  private readonly model = String(process.env.LLM_MODEL || '').trim()
  private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS || '12000')
  private readonly apiVersion = String(process.env.LLM_ANTHROPIC_VERSION || DEFAULT_ANTHROPIC_VERSION).trim()
  private readonly maxTokens = clampMaxTokens(process.env.LLM_MAX_TOKENS || `${DEFAULT_MAX_TOKENS}`)

  private get endpoint() {
    return normalizeMessagesEndpoint(this.baseUrl)
  }

  private get providerName() {
    return /minimax/i.test(this.baseUrl) ? 'minimax-anthropic-compatible' : 'anthropic-compatible'
  }

  getStatus() {
    return {
      ready: this.isReady(),
      model: this.model || null,
      provider: this.providerName,
      target: this.baseUrl || null,
      reason: this.isReady() ? null : 'missing_llm_env',
    }
  }

  isReady() {
    return Boolean(this.endpoint && this.apiKey && this.model)
  }

  async complete(request: LLMCompletionRequest): Promise<LLMResponse> {
    if (!this.isReady()) {
      const assistantMessage: LLMAssistantMessage = {
        role: 'assistant',
        content: null,
        toolCalls: [],
        contentBlocks: [],
      }

      return {
        assistantMessage,
        toolCalls: [],
        finishReason: 'stop',
      }
    }

    const requestTimeoutMs = Number.isFinite(Number(request.timeoutMs)) && Number(request.timeoutMs) > 0
      ? Number(request.timeoutMs)
      : this.timeoutMs
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: toSystemPrompt(request) || undefined,
          messages: toProviderMessages(request),
          tools: request.tools.length > 0 ? toToolDefinitions(request) : undefined,
          tool_choice: request.tools.length > 0 ? { type: 'auto' } : undefined,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`LLM request failed: ${response.status}${errorText ? ` ${errorText}` : ''}`)
      }

      const data = await response.json() as {
        content?: LLMContentBlock[]
        stop_reason?: string
      }

      const contentBlocks = Array.isArray(data.content) ? data.content : []
      const toolCalls = extractToolCalls(contentBlocks)
      const assistantMessage: LLMAssistantMessage = {
        role: 'assistant',
        content: normalizeAssistantContent(contentBlocks),
        toolCalls,
        contentBlocks,
      }

      return {
        assistantMessage,
        toolCalls,
        finishReason: toolCalls.length > 0 || data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
