import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendChatMessageStream } from '../aiService'

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

describe('sendChatMessageStream', () => {
  it('preserves visible whitespace across streamed chunks after think tags are removed', async () => {
    const onChunk = vi.fn()

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'data: {"content":"推荐 "}\n\n',
        'data: {"content":"<think>internal</think>湖北大学附近"}\n\n'
      ])
    )

    const responseText = await sendChatMessageStream(
      [{ role: 'user', content: '给我推荐湖北大学附近的地方' }],
      onChunk,
      { requestId: 'req_stream_whitespace_001' }
    )

    expect(responseText).toBe('推荐 湖北大学附近')
    expect(onChunk).toHaveBeenNthCalledWith(1, '推荐 ')
    expect(onChunk).toHaveBeenNthCalledWith(2, '湖北大学附近')
  })

  it('throws when backend sends SSE error event', async () => {
    const onChunk = vi.fn()
    const onMeta = vi.fn()

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse(
        [
          'event: stage\n',
          'data: {"name":"python_fallback_error"}\n\n',
          'event: error\n',
          'data: {"message":"spatial_service_unavailable"}\n\n'
        ],
        { 'X-Trace-Id': 'trace_test_001' }
      )
    )

    await expect(
      sendChatMessageStream(
        [{ role: 'user', content: '测试问题' }],
        onChunk,
        { requestId: 'req_test_001' },
        [],
        onMeta
      )
    ).rejects.toThrow('spatial_service_unavailable')

    expect(onChunk).not.toHaveBeenCalled()
    expect(onMeta).toHaveBeenCalledWith('stage', expect.objectContaining({ name: 'python_fallback_error' }))
    expect(onMeta).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'spatial_service_unavailable' }))
  })
})
