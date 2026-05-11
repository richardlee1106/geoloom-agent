import { PassThrough } from 'node:stream'

import type { FastifyInstance } from 'fastify'

import type { NarrativeAssistantProvider, NarrativeAssistantRequest, NarrativeBuilder, NarrativeEnrichmentJob, NarrativeRequest } from '../narrative/contract.js'
import type { NarrativeTtsProvider, NarrativeTtsRequest } from '../narrative/NarrativeTtsService.js'

function isNarrativeContractError(error: unknown): error is Error & { code: string; statusCode: number } {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
}

function writeNarrativeSseEvent(stream: PassThrough, event: string, data: unknown) {
  stream.write(`event: ${event}\n`)
  stream.write(`data: ${JSON.stringify(data)}\n\n`)
}

function narrativeEnrichmentJobVersion(job: NarrativeEnrichmentJob) {
  return [
    job.status,
    job.summary.status,
    job.summary.phase,
    job.summary.completed_region_count,
    job.summary.cached_region_count,
    job.summary.source_count,
    job.summary.updated_at || '',
    job.summary.completed_at || '',
    job.summary.error || '',
    job.error || '',
  ].join('|')
}

export async function registerNarrativeRoutes(
  app: FastifyInstance,
  deps: {
    narrative?: NarrativeBuilder
    assistant?: NarrativeAssistantProvider
    tts?: NarrativeTtsProvider
  },
) {
  app.post('/', async (request, reply) => {
    if (!deps.narrative) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_unavailable',
          message: 'Narrative runtime is unavailable',
        },
      })
    }

    try {
      const response = await deps.narrative.build((request.body || {}) as NarrativeRequest)
      return reply.send(response)
    } catch (error) {
      if (isNarrativeContractError(error)) {
        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        })
      }
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: {
          code: 'narrative_failed',
          message: error instanceof Error ? error.message : 'Narrative request failed',
        },
      })
    }
  })

  app.post('/assistant', async (request, reply) => {
    if (!deps.assistant) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_assistant_unavailable',
          message: 'Narrative assistant is unavailable',
        },
      })
    }

    try {
      const response = await deps.assistant.answer((request.body || {}) as NarrativeAssistantRequest)
      return reply.send(response)
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: {
          code: 'narrative_assistant_failed',
          message: error instanceof Error ? error.message : 'Narrative assistant request failed',
        },
      })
    }
  })

  app.get('/tts/health', async () => {
    return deps.tts?.health() ?? { enabled: false, ready: false }
  })

  app.post('/tts', async (request, reply) => {
    if (!deps.tts) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_tts_unavailable',
          message: 'Narrative TTS is unavailable',
        },
      })
    }

    try {
      const result = await deps.tts.synthesize((request.body || {}) as NarrativeTtsRequest)
      reply.header('cache-control', 'public, max-age=31536000, immutable')
      reply.header('x-narrative-tts-cache-key', result.cacheKey)
      reply.header('x-narrative-tts-cached', result.cached ? '1' : '0')
      return reply.type(result.contentType).send(result.audio)
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({
        success: false,
        error: {
          code: 'narrative_tts_failed',
          message: error instanceof Error ? error.message : 'Narrative TTS request failed',
        },
      })
    }
  })

  app.get('/enrichment/:jobId/events', async (request, reply) => {
    if (!deps.narrative?.getEnrichmentJob) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_enrichment_unavailable',
          message: 'Narrative enrichment is unavailable',
        },
      })
    }
    const jobId = String((request.params as { jobId?: string }).jobId || '').trim()
    const initialJob = deps.narrative.getEnrichmentJob(jobId)
    if (!initialJob) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'narrative_enrichment_not_found',
          message: 'Narrative enrichment job was not found',
        },
      })
    }

    const stream = new PassThrough()
    let streamClosed = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let lastVersion = ''
    const closeStream = () => {
      if (streamClosed) return
      streamClosed = true
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      stream.end()
    }
    const writeJob = (job: NarrativeEnrichmentJob) => {
      if (streamClosed || stream.destroyed || stream.writableEnded) return
      lastVersion = narrativeEnrichmentJobVersion(job)
      try {
        writeNarrativeSseEvent(stream, 'enrichment', job)
      } catch {
        closeStream()
        return
      }
      if (job.status === 'completed' || job.status === 'failed') closeStream()
    }
    const pollJob = () => {
      if (streamClosed || stream.destroyed || stream.writableEnded) {
        closeStream()
        return
      }
      const job = deps.narrative?.getEnrichmentJob?.(jobId)
      if (!job) {
        writeNarrativeSseEvent(stream, 'error', {
          success: false,
          error: {
            code: 'narrative_enrichment_not_found',
            message: 'Narrative enrichment job was not found',
          },
        })
        closeStream()
        return
      }
      const version = narrativeEnrichmentJobVersion(job)
      if (version !== lastVersion) writeJob(job)
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.send(stream)
    reply.raw.on('close', closeStream)
    writeJob(initialJob)
    if (!streamClosed) {
      pollTimer = setInterval(pollJob, 250)
      pollTimer.unref?.()
      heartbeatTimer = setInterval(() => {
        if (streamClosed || stream.destroyed || stream.writableEnded) {
          closeStream()
          return
        }
        stream.write(': keepalive\n\n')
      }, 15000)
      heartbeatTimer.unref?.()
    }
    return reply
  })

  app.get('/enrichment/:jobId', async (request, reply) => {
    if (!deps.narrative?.getEnrichmentJob) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'narrative_enrichment_unavailable',
          message: 'Narrative enrichment is unavailable',
        },
      })
    }
    const jobId = String((request.params as { jobId?: string }).jobId || '').trim()
    const job = deps.narrative.getEnrichmentJob(jobId)
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'narrative_enrichment_not_found',
          message: 'Narrative enrichment job was not found',
        },
      })
    }
    return reply.send(job)
  })
}
