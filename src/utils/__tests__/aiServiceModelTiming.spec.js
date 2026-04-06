import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendChatMessageStream } from '../aiService.js'

function createSseResponse(chunks, headers = {}) {
  const encoder = new TextEncoder()
  const encodedChunks = chunks.map((chunk) => encoder.encode(chunk))
  let index = 0

  return {
    ok: true,
    headers: {
      get(name) {
        return headers[name] || headers[name.toLowerCase()] || null
      }
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encodedChunks.length) {
              return { done: true, value: undefined }
            }
            return { done: false, value: encodedChunks[index++] }
          }
        }
      }
    }
  }
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('sendChatMessageStream model timing log', () => {
  it('prints [ModelTiming] from stats/refined_result once for identical payload', async () => {
    const onChunk = vi.fn()
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'event: stats\n',
        'data: {"model_timing_ms":{"vlm_ms":123.4,"llm_ms":456.7,"parallel_wall_ms":789.1,"budget_ms":5000}}\n\n',
        'event: refined_result\n',
        'data: {"results":{"stats":{"model_timing_ms":{"vlm_ms":123.4,"llm_ms":456.7,"parallel_wall_ms":789.1,"budget_ms":5000}}}}\n\n'
      ])
    )

    const responseText = await sendChatMessageStream(
      [{ role: 'user', content: 'test model timing' }],
      onChunk,
      { requestId: 'req_model_timing_001' },
      []
    )

    expect(responseText).toBe('')
    expect(onChunk).not.toHaveBeenCalled()

    const timingLogs = consoleLog.mock.calls
      .map((entry) => String(entry?.[0] || ''))
      .filter((entry) => entry.includes('[ModelTiming]'))

    expect(timingLogs).toHaveLength(1)
    expect(timingLogs[0]).toContain('VLM=123ms')
    expect(timingLogs[0]).toContain('LLM=457ms')
    expect(timingLogs[0]).toContain('WALL=789ms')
    expect(timingLogs[0]).toContain('BUDGET=5000ms')
  })
})
