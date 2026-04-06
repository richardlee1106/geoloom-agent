import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { SSEWriter } from '../../../src/chat/SSEWriter.js'

function parseSSE(raw: string) {
  return raw
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = block
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice(7)
        .trim()
      const dataLine = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
      const data = dataLine ? JSON.parse(dataLine.slice(6)) : null
      return { event, data }
    })
}

function captureStream(stream: PassThrough) {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    stream.on('end', () => resolve(output))
    stream.on('error', reject)
  })
}

describe('SSEWriter', () => {
  it('writes ordered events with required meta fields', async () => {
    const stream = new PassThrough()
    const writer = new SSEWriter({
      stream,
      traceId: 'trace_v4_001',
      schemaVersion: 'v4.det.v1',
    })
    const captured = captureStream(stream)

    await writer.trace({ request_id: 'req_v4_001' })
    await writer.job({ mode: 'deterministic_single_turn' })
    await writer.stage('intent')
    await writer.thinking({ status: 'start', message: '正在识别问题类型...' })
    await writer.done({ duration_ms: 88 })
    writer.close()

    const events = parseSSE(await captured)
    expect(events.map((item) => item.event)).toEqual(['trace', 'job', 'stage', 'thinking', 'done'])
    for (const item of events) {
      expect(item.data.trace_id).toBe('trace_v4_001')
      expect(item.data.schema_version).toBe('v4.det.v1')
    }
  })

  it('emits error payloads in a stable shape', async () => {
    const stream = new PassThrough()
    const writer = new SSEWriter({
      stream,
      traceId: 'trace_v4_002',
      schemaVersion: 'v4.det.v1',
    })
    const captured = captureStream(stream)

    await writer.error(new Error('skill failed'))
    writer.close()

    const events = parseSSE(await captured)
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe('error')
    expect(events[0]?.data.message).toBe('skill failed')
  })
})
