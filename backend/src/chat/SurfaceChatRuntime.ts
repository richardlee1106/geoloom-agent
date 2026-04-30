import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import type { ChatRuntime } from '../app.js'
import { SSEWriter } from './SSEWriter.js'
import type { ChatRequestV4 } from './types.js'

export class SurfaceChatRuntime implements ChatRuntime {
  constructor(private readonly options: {
    defaultRuntime: ChatRuntime
  }) {}

  createWriter(stream: NodeJS.WritableStream, traceId = randomUUID()) {
    return new SSEWriter({
      stream: stream as Writable,
      traceId,
      schemaVersion: 'v4.surface.v1',
    })
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    await this.options.defaultRuntime.handle(request, writer)
  }

  async getHealth(): Promise<Record<string, unknown>> {
    const defaultHealth = await this.options.defaultRuntime.getHealth?.()
    return {
      ...(defaultHealth || {}),
    }
  }
}
