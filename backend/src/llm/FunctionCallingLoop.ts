import type { ToolExecutionTrace } from '../chat/types.js'
import type { LLMAssistantMessage, LLMMessage, LLMProvider, ToolCallRequest, ToolSchema } from './types.js'

export interface FunctionCallingLoopOptions<TResult> {
  provider: LLMProvider
  tools: ToolSchema[]
  messages: LLMMessage[]
  maxRounds?: number
  onToolCall: (call: ToolCallRequest) => Promise<{ content: string, trace: ToolExecutionTrace }>
}

export interface FunctionCallingLoopResult {
  assistantMessage: LLMAssistantMessage | null
  traces: ToolExecutionTrace[]
}

function normalizeResponse(response: unknown) {
  const normalized = response as {
    assistantMessage?: LLMAssistantMessage
    message?: string | null
    toolCalls?: ToolCallRequest[]
    finishReason?: 'tool_calls' | 'stop'
  }
  const toolCalls = Array.isArray(normalized.toolCalls) ? normalized.toolCalls : []

  return {
    assistantMessage: normalized.assistantMessage || {
      role: 'assistant' as const,
      content: normalized.message ?? null,
      toolCalls,
    },
    toolCalls,
    finishReason: normalized.finishReason || (toolCalls.length > 0 ? 'tool_calls' as const : 'stop' as const),
  }
}

export async function runFunctionCallingLoop<TResult = unknown>(
  options: FunctionCallingLoopOptions<TResult>,
): Promise<FunctionCallingLoopResult> {
  const traces: ToolExecutionTrace[] = []
  const messages = [...options.messages]
  const seenFingerprints = new Set<string>()
  const maxRounds = options.maxRounds || 4

  for (let round = 0; round < maxRounds; round += 1) {
    const response = normalizeResponse(await options.provider.complete({
      messages,
      tools: options.tools,
    }))

    if (response.toolCalls.length === 0) {
      return {
        assistantMessage: response.assistantMessage,
        traces,
      }
    }

    messages.push({
      role: 'assistant',
      content: response.assistantMessage.content,
      toolCalls: response.assistantMessage.toolCalls,
    })

    for (const call of response.toolCalls) {
      const fingerprint = JSON.stringify({
        name: call.name,
        arguments: call.arguments,
      })

      if (seenFingerprints.has(fingerprint)) {
        return {
          assistantMessage: response.assistantMessage,
          traces,
        }
      }
      seenFingerprints.add(fingerprint)

      const toolResult = await options.onToolCall(call)
      traces.push(toolResult.trace)
      messages.push({
        role: 'tool',
        name: call.name,
        toolCallId: call.id,
        content: toolResult.content,
      })
    }
  }

  return {
    assistantMessage: null,
    traces,
  }
}
