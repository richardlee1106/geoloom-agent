import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import type { ChatRuntime } from '../app.js'
import { SSEWriter } from './SSEWriter.js'
import type { ChatRequestV4 } from './types.js'

function normalizeSurface(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'narrative' ? 'narrative' : 'default'
}

export class SurfaceChatRuntime implements ChatRuntime {
  constructor(private readonly options: {
    defaultRuntime: ChatRuntime
    narrativeRuntime: ChatRuntime
  }) {}

  createWriter(stream: NodeJS.WritableStream, traceId = randomUUID()) {
    return new SSEWriter({
      stream: stream as Writable,
      traceId,
      schemaVersion: 'v4.surface.v1',
    })
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    const runtime = normalizeSurface(request.options?.surface) === 'narrative'
      ? this.options.narrativeRuntime
      : this.options.defaultRuntime
    await runtime.handle(request, writer)
  }

  async getHealth() {
    return {
      default: await this.options.defaultRuntime.getHealth?.(),
      narrative: await this.options.narrativeRuntime.getHealth?.(),
    }
  }
}
