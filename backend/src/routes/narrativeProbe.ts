import type { FastifyInstance } from 'fastify'

import type { NarrativeRuntime } from '../narrative/NarrativeRuntime.js'
import type { NarrativeProbeRequest } from '../narrative/probeTypes.js'
import type { NarrativeViewport } from '../narrative/types.js'

interface RawProbeBody {
  viewport?: unknown
  rawQuery?: unknown
  raw_query?: unknown
  includeEncoder?: unknown
  include_encoder?: unknown
  topRaw?: unknown
  top_raw?: unknown
}

// 支持两种 viewport 格式：
//   [swLon, swLat, neLon, neLat] —— 与 SSE 请求的 spatialContext.viewport 对齐
//   { swLon, swLat, neLon, neLat }
function parseViewport(raw: unknown): NarrativeViewport | null {
  if (Array.isArray(raw) && raw.length >= 4) {
    const [a, b, c, d] = raw.map((v) => Number(v))
    if (![a, b, c, d].every(Number.isFinite)) return null
    return {
      swLon: Math.min(a, c),
      swLat: Math.min(b, d),
      neLon: Math.max(a, c),
      neLat: Math.max(b, d),
    }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const swLon = Number(obj.swLon ?? obj.sw_lon ?? obj.minLon ?? obj.min_lon)
    const swLat = Number(obj.swLat ?? obj.sw_lat ?? obj.minLat ?? obj.min_lat)
    const neLon = Number(obj.neLon ?? obj.ne_lon ?? obj.maxLon ?? obj.max_lon)
    const neLat = Number(obj.neLat ?? obj.ne_lat ?? obj.maxLat ?? obj.max_lat)
    if (![swLon, swLat, neLon, neLat].every(Number.isFinite)) return null
    return {
      swLon: Math.min(swLon, neLon),
      swLat: Math.min(swLat, neLat),
      neLon: Math.max(swLon, neLon),
      neLat: Math.max(swLat, neLat),
    }
  }
  return null
}

export async function registerNarrativeProbeRoutes(
  app: FastifyInstance,
  deps: { narrativeRuntime: NarrativeRuntime },
) {
  app.post('/narrative/probe', async (request, reply) => {
    const body = (request.body || {}) as RawProbeBody
    const viewport = parseViewport(body.viewport)

    if (!viewport) {
      reply.code(400).send({
        ok: false,
        error: 'viewport 参数缺失或无效。接受 [swLon, swLat, neLon, neLat] 数组或对象形式。',
      })
      return reply
    }

    const input: NarrativeProbeRequest = {
      viewport,
      rawQuery: typeof (body.rawQuery ?? body.raw_query) === 'string'
        ? String(body.rawQuery ?? body.raw_query)
        : undefined,
      includeEncoder: Boolean(body.includeEncoder ?? body.include_encoder),
      topRaw: Number.isFinite(Number(body.topRaw ?? body.top_raw))
        ? Number(body.topRaw ?? body.top_raw)
        : undefined,
    }

    try {
      const result = await deps.narrativeRuntime.probe(input)
      reply.send({ ok: true, data: result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      request.log.error({ err: error }, 'narrative probe failed')
      reply.code(500).send({ ok: false, error: message })
    }
    return reply
  })
}
