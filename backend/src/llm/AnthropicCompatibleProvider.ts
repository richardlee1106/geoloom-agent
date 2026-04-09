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
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 250

export interface AnthropicCompatibleProviderOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  timeoutMs?: number | string
  apiVersion?: string
  maxTokens?: number | string
}

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

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function isHardRateLimitError(status: number, errorText: string) {
  if (status !== 429) return false

  const normalized = String(errorText || '').trim().toLowerCase()
  if (!normalized) return false

  return normalized.includes('usage limit exceeded')
    || normalized.includes('"type":"rate_limit_error"')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  let pendingToolResults: Array<Record<string, unknown>> = []

  const flushPendingToolResults = () => {
    if (pendingToolResults.length === 0) return
    providerMessages.push({
      role: 'user',
      content: pendingToolResults,
    })
    pendingToolResults = []
  }

  for (const message of request.messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      flushPendingToolResults()
      providerMessages.push({
        role: 'user',
        content: message.content ? [asTextBlock(message.content)] : [],
      })
      continue
    }

    if (message.role === 'assistant') {
      flushPendingToolResults()
      providerMessages.push({
        role: 'assistant',
        content: toAssistantBlocks(message),
      })
      continue
    }

    pendingToolResults.push({
      type: 'tool_result',
      tool_use_id: message.toolCallId || randomUUID(),
      content: message.content || '',
    })
  }

  flushPendingToolResults()

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
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly apiVersion: string
  private readonly maxTokens: number

  constructor(options: AnthropicCompatibleProviderOptions = {}) {
    this.baseUrl = String(options.baseUrl ?? process.env.LLM_BASE_URL ?? '').trim()
    this.apiKey = String(options.apiKey ?? process.env.LLM_API_KEY ?? '').trim()
    this.model = String(options.model ?? process.env.LLM_MODEL ?? '').trim()
    this.timeoutMs = Number(options.timeoutMs ?? process.env.LLM_TIMEOUT_MS ?? '12000')
    this.apiVersion = String(options.apiVersion ?? process.env.LLM_ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION).trim()
    this.maxTokens = clampMaxTokens(options.maxTokens ?? process.env.LLM_MAX_TOKENS ?? `${DEFAULT_MAX_TOKENS}`)
  }

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
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
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
          const shouldRetry = isRetryableStatus(response.status) && !isHardRateLimitError(response.status, errorText)
          if (attempt < MAX_TRANSIENT_RETRIES && shouldRetry) {
            await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
            continue
          }
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

    throw new Error('LLM request failed: exhausted retries')
  }
}
