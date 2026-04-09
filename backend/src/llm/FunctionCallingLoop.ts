import type { ToolExecutionTrace } from '../chat/types.js'
import type { LLMAssistantMessage, LLMMessage, LLMProvider, ToolCallRequest, ToolSchema } from './types.js'

export interface FunctionCallingLoopOptions<TResult> {
  provider: LLMProvider
  tools: ToolSchema[]
  messages: LLMMessage[]
  maxRounds?: number
  requestTimeoutMs?: number
  onToolCall: (call: ToolCallRequest) => Promise<{ content: string, trace: ToolExecutionTrace }>
  onToolCallBatch?: (calls: ToolCallRequest[]) => Promise<Array<{ content: string, trace: ToolExecutionTrace }>>
  onAssistantMessage?: (message: LLMAssistantMessage, meta: {
    round: number
    finishReason: 'tool_calls' | 'stop'
    toolCallCount: number
  }) => Promise<void> | void
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

function classifyExecutionPhase(call: ToolCallRequest) {
  const action = String(call.arguments.action || '').trim()
  if (call.name === 'postgis' && action === 'resolve_anchor') {
    return 'resolve_anchor'
  }
  if (
    (call.name === 'postgis' && action === 'execute_spatial_sql')
    || call.name === 'route_distance'
  ) {
    return 'evidence_fetch'
  }
  if (
    (call.name === 'semantic_selector' && action === 'select_area_evidence')
    || call.name === 'spatial_encoder'
    || call.name === 'spatial_vector'
  ) {
    return 'semantic_refinement'
  }
  return `${call.name}:${action || 'unknown'}:serial`
}

function buildToolCallBatches(calls: ToolCallRequest[], seenFingerprints: Set<string>) {
  const batches: ToolCallRequest[][] = []
  let currentBatch: ToolCallRequest[] = []
  let currentWave: string | null = null
  let hitDuplicate = false

  for (const call of calls) {
    const fingerprint = JSON.stringify({
      name: call.name,
      arguments: call.arguments,
    })

    if (seenFingerprints.has(fingerprint)) {
      hitDuplicate = true
      break
    }
    seenFingerprints.add(fingerprint)

    const wave = classifyExecutionPhase(call)
    if (currentBatch.length === 0 || currentWave === wave) {
      currentBatch.push(call)
      currentWave = wave
      continue
    }

    batches.push(currentBatch)
    currentBatch = [call]
    currentWave = wave
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return {
    batches,
    hitDuplicate,
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
      timeoutMs: options.requestTimeoutMs,
    }))

    if (options.onAssistantMessage) {
      await options.onAssistantMessage(response.assistantMessage, {
        round,
        finishReason: response.finishReason,
        toolCallCount: response.toolCalls.length,
      })
    }

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

    const { batches, hitDuplicate } = buildToolCallBatches(response.toolCalls, seenFingerprints)
    for (const batch of batches) {
      const toolResults = options.onToolCallBatch && batch.length > 1
        ? await options.onToolCallBatch(batch)
        : await Promise.all(batch.map((call) => options.onToolCall(call)))

      for (let index = 0; index < batch.length; index += 1) {
        const call = batch[index]
        const toolResult = toolResults[index]
        traces.push(toolResult.trace)
        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: toolResult.content,
        })
      }
    }

    if (hitDuplicate) {
      return {
        assistantMessage: response.assistantMessage,
        traces,
      }
    }
  }

  return {
    assistantMessage: null,
    traces,
  }
}
