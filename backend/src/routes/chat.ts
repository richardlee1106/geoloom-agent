import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'

import type { FastifyInstance } from 'fastify'

import type { ChatRequestV4 } from '../chat/types.js'
import type { ChatRuntime } from '../app.js'

type LegacyChatRequestBody = Partial<ChatRequestV4> & {
  message?: unknown
  query?: unknown
  userQuery?: unknown
  user_query?: unknown
  requestId?: unknown
  request_id?: unknown
  sessionId?: unknown
  session_id?: unknown
}

function normalizeLegacyText(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function normalizeChatRequestBody(rawBody: LegacyChatRequestBody = {}): ChatRequestV4 {
  const legacyMessage = normalizeLegacyText(
    rawBody.message
    ?? rawBody.query
    ?? rawBody.userQuery
    ?? rawBody.user_query,
  )
  const messages = Array.isArray(rawBody.messages) && rawBody.messages.length > 0
    ? rawBody.messages
    : legacyMessage
      ? [{ role: 'user', content: legacyMessage }]
      : []

  const options = {
    ...(rawBody.options && typeof rawBody.options === 'object' ? rawBody.options : {}),
  }

  if (!options.requestId) {
    const requestId = normalizeLegacyText(rawBody.requestId ?? rawBody.request_id)
    if (requestId) {
      options.requestId = requestId
    }
  }

  if (!options.sessionId) {
    const sessionId = normalizeLegacyText(rawBody.sessionId ?? rawBody.session_id)
    if (sessionId) {
      options.sessionId = sessionId
    }
  }

  return {
    messages,
    poiFeatures: Array.isArray(rawBody.poiFeatures) ? rawBody.poiFeatures : [],
    options,
  }
}

export async function registerChatRoutes(
  app: FastifyInstance,
  deps: {
    chat: ChatRuntime
  },
) {
  app.post('/chat', async (request, reply) => {
    const body = normalizeChatRequestBody((request.body || {}) as LegacyChatRequestBody)
    const traceId = String(body.options?.requestId || randomUUID())
    const stream = new PassThrough()
    const writer = deps.chat.createWriter(stream, traceId)

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Trace-Id', traceId)
    reply.send(stream)

    try {
      await deps.chat.handle(body, writer)
    } catch (error) {
      await writer.error(error)
    } finally {
      writer.close()
    }

    return reply
  })
}
