import { AI_API_BASE_URL } from '../config'
import { validateSSEEventPayload, type SSEValidationResult } from '../../shared/sseEventSchema'

export interface ParsedSseEvent<T = unknown> {
  event: string
  payload: T | null
  validation: SSEValidationResult
}

export interface StreamGeoChatArgs {
  messages: unknown[]
  options?: Record<string, unknown>
  onEvent?: (eventName: string, payload: unknown) => void
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const message = (payload as Record<string, unknown>).message
  return message ? String(message) : null
}

export function resolveApiBase(): string {
  return String(import.meta.env.VITE_GEOLOOM_API_BASE || AI_API_BASE_URL || '').replace(/\/$/, '')
}

export async function fetchHealth(): Promise<unknown> {
  const response = await fetch(`${resolveApiBase()}/api/geo/health`)
  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`)
  }
  return response.json()
}

export function parseSseEventBlock<T = unknown>(block: unknown): ParsedSseEvent<T> {
  const lines = String(block || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7).trim() || 'message'
  const rawData = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n')

  const payload = rawData ? (JSON.parse(rawData) as T) : null
  const validation = validateSSEEventPayload(eventName, payload)

  return {
    event: eventName,
    payload,
    validation
  }
}

export async function streamGeoChat({
  messages,
  options = {},
  onEvent
}: StreamGeoChatArgs): Promise<void> {
  const response = await fetch(`${resolveApiBase()}/api/geo/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages,
      options
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Chat request failed with ${response.status}: ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response body is not readable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''

    for (const block of blocks) {
      if (!block.trim()) continue
      const parsed = parseSseEventBlock(block)

      if (!parsed.validation.ok) {
        onEvent?.('schema_error', {
          event: parsed.event,
          errors: parsed.validation.errors
        })
        continue
      }

      onEvent?.(parsed.event, parsed.payload)

      if (parsed.event === 'error') {
        throw new Error(extractErrorMessage(parsed.payload) || 'Unknown chat error')
      }
    }
  }
}
