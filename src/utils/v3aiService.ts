import { AI_API_BASE_URL } from '../config'
import { validateSSEEventPayload } from '../../shared/sseEventSchema'

const V3_API_BASE = `${AI_API_BASE_URL}/api`
const V3_META_EVENTS = new Set([
  'stage',
  'thinking',
  'reasoning',
  'intent_preview',
  'pois',
  'boundary',
  'spatial_clusters',
  'vernacular_regions',
  'fuzzy_regions',
  'stats',
  'partial',
  'progress',
  'refined_result',
  'done',
  'error'
] as const)

type V3MetaEventType = (typeof V3_META_EVENTS extends Set<infer T> ? T : never) | 'trace' | 'schema_error'

type V3ServiceStatus = {
  online: boolean
  model: string | null
  models: unknown[]
  ollama?: unknown
}

type V3Message = {
  role?: unknown
  content?: unknown
  [key: string]: unknown
}

type V3Options = Record<string, unknown>

type V3MetaHandler = (type: V3MetaEventType, data: Record<string, unknown> | unknown[] | null) => void
type V3ChunkHandler = (text: string) => void

type StructuredValidationResult = {
  ok: boolean
  errors: string[]
}

type ParsedSseRecord = Record<string, unknown>

let serviceStatus: V3ServiceStatus = {
  online: false,
  model: null,
  models: []
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error || '')
}

export async function checkV3Service(): Promise<boolean> {
  try {
    const response = await fetch(`${V3_API_BASE}/ai/status`)
    if (!response.ok) {
      serviceStatus.online = false
      return false
    }

    const data = await response.json() as Record<string, unknown>
    serviceStatus = {
      online: Boolean(data.online),
      model: typeof data.model === 'string' ? data.model : null,
      models: Array.isArray(data.models) ? data.models : [],
      ollama: data.ollama
    }

    console.log(`[V3 AI] 服务状态: ${serviceStatus.online ? '在线' : '离线'}, 模型: ${serviceStatus.model}`)
    return serviceStatus.online
  } catch (error) {
    console.debug('[V3 AI] 状态检查失败:', getErrorMessage(error))
    serviceStatus.online = false
    return false
  }
}

export async function sendV3ChatStream(
  messages: V3Message[],
  onChunk: V3ChunkHandler,
  options: V3Options = {},
  poiFeatures: unknown[] = [],
  onMeta: V3MetaHandler | null = null
): Promise<string> {
  const requestId =
    options?.requestId ||
    options?.request_id ||
    `v3_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  console.log('[V3 AI] 发送聊天请求, 消息数:', messages.length)

  const response = await fetch(`${V3_API_BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      poiFeatures,
      options: { ...options, requestId }
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`V3 AI 请求失败: ${response.status} - ${error}`)
  }

  if (!response.body) {
    throw new Error('V3 AI 响应缺少流式内容')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''
  let currentEvent: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (!line.startsWith('data: ')) continue

      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data) as ParsedSseRecord
        const eventType = String(parsed?.type || currentEvent || '').trim()
        const payload = parsed?.type ? extractEventPayload(parsed) : parsed

        switch (eventType) {
          case 'meta': {
            if (onMeta) {
              const payloadRecord = isRecord(payload) ? payload : {}
              onMeta('trace', {
                trace_id: payloadRecord.traceId || payloadRecord.trace_id || requestId,
                schema_version: payloadRecord.schema_version || null,
                capabilities: Array.isArray(payloadRecord.capabilities) ? payloadRecord.capabilities : null
              })
            }
            break
          }

          case 'text': {
            const payloadRecord = isRecord(payload) ? payload : {}
            const rawContent = typeof payloadRecord.content === 'string' ? payloadRecord.content : ''
            const visibleChunk = stripThinkTags(rawContent)
            if (visibleChunk !== '') {
              fullContent += visibleChunk
              onChunk(visibleChunk)
            }
            break
          }

          default: {
            if (!V3_META_EVENTS.has(eventType as (typeof V3_META_EVENTS extends Set<infer T> ? T : never))) {
              currentEvent = null
              break
            }

            const validation = validateStructuredEvent(eventType, payload)
            if (!validation.ok) {
              if (onMeta) {
                onMeta('schema_error', {
                  event: eventType,
                  errors: validation.errors
                })
              }
              break
            }

            if (eventType === 'error') {
              if (onMeta) onMeta('error', isRecord(payload) ? payload : null)
              const message = isRecord(payload) && typeof payload.message === 'string'
                ? payload.message
                : 'V3 AI 错误'
              const streamError = new Error(message)
              streamError.name = 'V3AIStreamError'
              throw streamError
            }

            if (onMeta) {
              onMeta(eventType as V3MetaEventType, Array.isArray(payload) || isRecord(payload) ? payload : null)
            }
            break
          }
        }
      } catch (error) {
        if (error instanceof Error && (error.name === 'V3AIStreamError' || error.message.includes('V3'))) {
          throw error
        }
        console.warn('[V3 AI] 解析 SSE 失败:', getErrorMessage(error))
      } finally {
        currentEvent = null
      }
    }
  }

  return fullContent
}

export async function askV3(
  query: string,
  options: { topK?: unknown } = {}
): Promise<{
  answer: unknown
  results: unknown[]
  intent: unknown
  pipeline: unknown
  totalDuration: unknown
}> {
  const topK = Number(options.topK) || 10

  console.log('[V3 AI] 空间查询:', query)

  const response = await fetch(`${V3_API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`V3 查询失败: ${response.status} - ${error}`)
  }

  const data = await response.json() as Record<string, unknown>

  return {
    answer: data.answer,
    results: Array.isArray(data.results) ? data.results : [],
    intent: data.intent,
    pipeline: data.pipeline,
    totalDuration: data.total_duration_ms
  }
}

export function getV3Status(): V3ServiceStatus {
  return { ...serviceStatus }
}

export async function getV3Models(): Promise<unknown[]> {
  try {
    const response = await fetch(`${V3_API_BASE}/ai/models`)
    if (!response.ok) return []
    const data = await response.json() as Record<string, unknown>
    return Array.isArray(data.models) ? data.models : []
  } catch {
    return []
  }
}

function stripThinkTags(text: unknown): string {
  const raw = String(text || '')
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')

  if (cleaned.trim()) {
    return cleaned
  }

  return /<\/?think>/i.test(raw) ? '' : cleaned
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractEventPayload(parsed: ParsedSseRecord): Record<string, unknown> | unknown[] | ParsedSseRecord {
  if (!parsed || typeof parsed !== 'object') return parsed

  if (parsed.payload !== undefined) {
    return parsed.payload as Record<string, unknown> | unknown[]
  }

  if (parsed.data !== undefined) {
    return parsed.data as Record<string, unknown> | unknown[]
  }

  const payload = { ...parsed }
  delete payload.type
  return payload
}

function validateStructuredEvent(eventType: string, payload: unknown): StructuredValidationResult {
  if (eventType === 'thinking') {
    if (!isRecord(payload)) {
      return { ok: false, errors: ['$: expected object'] }
    }
    return { ok: true, errors: [] }
  }

  if (eventType === 'done') {
    if (!isRecord(payload)) {
      return { ok: false, errors: ['$: expected object'] }
    }
    return { ok: true, errors: [] }
  }

  if (eventType === 'reasoning') {
    if (!isRecord(payload) || typeof payload.content !== 'string') {
      return { ok: false, errors: ['$.content: expected string'] }
    }
    return { ok: true, errors: [] }
  }

  return validateSSEEventPayload(eventType, payload)
}

export const v3Compat = {
  sendChatMessageStream: sendV3ChatStream,
  checkAIService: checkV3Service,
  getAvailableModels: getV3Models,
  getCurrentProviderInfo: () => ({
    id: 'v3-ollama',
    name: 'V3 GeoEncoder RAG',
    apiBase: V3_API_BASE,
    modelId: serviceStatus.model || 'qwen3.5-2b'
  })
}

export default {
  checkV3Service,
  sendV3ChatStream,
  askV3,
  getV3Status,
  getV3Models,
  v3Compat
}
