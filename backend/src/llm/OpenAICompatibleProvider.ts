import { randomUUID } from 'node:crypto'

import type { LLMCompletionRequest, LLMAssistantMessage, LLMProvider, LLMResponse } from './types.js'

function toToolDefinitions(request: LLMCompletionRequest) {
  return request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

function toProviderMessages(request: LLMCompletionRequest) {
  return request.messages.map((message) => ({
    role: message.role,
    content: message.content,
    name: message.name,
    tool_call_id: message.toolCallId,
    tool_calls: message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0
      ? message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments || {}),
        },
      }))
      : undefined,
  }))
}

function normalizeAssistantContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String(item.text || '')
        }
        return ''
      })
      .join('')
      .trim() || null
  }

  return null
}

function parseToolArguments(argumentsText: string | undefined) {
  if (!argumentsText) return {}

  try {
    return JSON.parse(argumentsText) as Record<string, unknown>
  } catch {
    return {
      raw_arguments: argumentsText,
    }
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly baseUrl = String(process.env.LLM_BASE_URL || '').trim()
  private readonly apiKey = String(process.env.LLM_API_KEY || '').trim()
  private readonly model = String(process.env.LLM_MODEL || '').trim()
  private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS || '12000')

  private get providerName() {
    return /minimax/i.test(this.baseUrl) ? 'minimax-openai-compatible' : 'openai-compatible'
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
    return Boolean(this.baseUrl && this.apiKey && this.model)
  }

  async complete(request: LLMCompletionRequest): Promise<LLMResponse> {
    if (!this.isReady()) {
      const assistantMessage: LLMAssistantMessage = {
        role: 'assistant',
        content: null,
        toolCalls: [],
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
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: toProviderMessages(request),
          tools: toToolDefinitions(request),
          tool_choice: 'auto',
        }),
      })

      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`)
      }

      const data = await response.json() as {
        choices?: Array<{
          finish_reason?: string
          message?: {
            content?: unknown
            tool_calls?: Array<{
              id?: string
              function?: {
                name?: string
                arguments?: string
              }
            }>
          }
        }>
      }

      const choice = data.choices?.[0]
      const toolCalls = (choice?.message?.tool_calls || []).map((toolCall) => ({
        id: toolCall.id || randomUUID(),
        name: String(toolCall.function?.name || ''),
        arguments: parseToolArguments(toolCall.function?.arguments),
      }))
      const assistantMessage: LLMAssistantMessage = {
        role: 'assistant',
        content: normalizeAssistantContent(choice?.message?.content),
        toolCalls,
      }

      return {
        assistantMessage,
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
