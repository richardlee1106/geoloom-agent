import type { Writable } from 'node:stream'

export interface SSEWriterOptions {
  stream: Writable
  traceId: string
  schemaVersion: string
}

export class SSEWriter {
  readonly traceId: string
  readonly schemaVersion: string

  constructor(private readonly options: SSEWriterOptions) {
    this.traceId = options.traceId
    this.schemaVersion = options.schemaVersion
  }

  trace(payload: Record<string, unknown> = {}) {
    return this.write('trace', payload)
  }

  job(payload: Record<string, unknown>) {
    return this.write('job', payload)
  }

  stage(nameOrPayload: string | Record<string, unknown>) {
    const payload = typeof nameOrPayload === 'string'
      ? { name: nameOrPayload }
      : nameOrPayload
    return this.write('stage', payload)
  }

  thinking(payload: Record<string, unknown>) {
    return this.write('thinking', payload)
  }

  reasoning(payload: Record<string, unknown>) {
    return this.write('reasoning', payload)
  }

  intentPreview(payload: Record<string, unknown>) {
    return this.write('intent_preview', payload)
  }

  pois(payload: unknown[]) {
    return this.write('pois', payload)
  }

  boundary(payload: Record<string, unknown>) {
    return this.write('boundary', payload)
  }

  spatialClusters(payload: Record<string, unknown>) {
    return this.write('spatial_clusters', payload)
  }

  vernacularRegions(payload: unknown[]) {
    return this.write('vernacular_regions', payload)
  }

  fuzzyRegions(payload: unknown[]) {
    return this.write('fuzzy_regions', payload)
  }

  stats(payload: Record<string, unknown>) {
    return this.write('stats', payload)
  }

  refinedResult(payload: Record<string, unknown>) {
    return this.write('refined_result', payload)
  }

  done(payload: Record<string, unknown>) {
    return this.write('done', payload)
  }

  error(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown V4 chat error')
    return this.write('error', { message })
  }

  close() {
    this.options.stream.end()
  }

  private withMeta(payload: unknown) {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== 'object') return payload

    return {
      ...payload,
      trace_id: this.traceId,
      schema_version: this.schemaVersion,
    }
  }

  private write(event: string, payload: unknown) {
    const block = `event: ${event}\ndata: ${JSON.stringify(this.withMeta(payload))}\n\n`
    this.options.stream.write(block)
    return Promise.resolve()
  }
}
