import type { JsonSchema } from '../skills/types.js'

export interface ToolSchema {
  name: string
  description: string
  inputSchema: JsonSchema
}

export interface LLMContentBlock {
  type: string
  [key: string]: unknown
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LLMProviderStatus {
  ready: boolean
  model: string | null
  provider: string
  target?: string | null
  reason?: string | null
}

export interface LLMAssistantMessage {
  role: 'assistant'
  content: string | null
  toolCalls: ToolCallRequest[]
  contentBlocks?: LLMContentBlock[]
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  toolCallId?: string
  toolCalls?: ToolCallRequest[]
  contentBlocks?: LLMContentBlock[]
}

export interface LLMResponse {
  assistantMessage: LLMAssistantMessage
  toolCalls: ToolCallRequest[]
  finishReason: 'tool_calls' | 'stop'
}

export interface LLMCompletionRequest {
  messages: LLMMessage[]
  tools: ToolSchema[]
  timeoutMs?: number
}

export interface LLMProvider {
  getStatus(): LLMProviderStatus
  isReady(): boolean
  complete(request: LLMCompletionRequest): Promise<LLMResponse>
}
