import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendV3ChatStream } from '../v3aiService.js'

function createSseResponse(chunks) {
  const encoder = new TextEncoder()
  const encodedChunks = chunks.map((chunk) => encoder.encode(chunk))
  let index = 0

  return {
    ok: true,
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

describe('sendV3ChatStream', () => {
  it('relays structured V3 SSE events to onMeta while streaming visible text', async () => {
    const onChunk = vi.fn()
    const onMeta = vi.fn()

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'data: {"type":"meta","traceId":"trace_v3_001"}\n\n',
        'data: {"type":"stage","name":"reasoning","label":"空间推理","hint":"正在聚合空间证据","schema_version":"v3.1"}\n\n',
        'data: {"type":"pois","payload":[{"id":1,"name":"湖北大学","category":"科教文化服务","lon":114.35,"lat":30.55}]}\n\n',
        'data: {"type":"stats","result_count":1,"model_timing_ms":{"llm_ms":123}}\n\n',
        'data: {"type":"refined_result","results":{"boundary":{"type":"Polygon","coordinates":[[[114.3,30.5],[114.4,30.5],[114.4,30.6],[114.3,30.6],[114.3,30.5]]]},"spatial_clusters":{"hotspots":[{"id":"hotspot-1","name":"湖北大学片区","poiCount":1,"center":[114.35,30.55]}]},"stats":{"cluster_count":1}}}\n\n',
        'data: {"type":"reasoning","content":"先确定锚点，再筛选候选。"}\n\n',
        'data: {"type":"text","content":"推荐先看湖北大学周边。"}\n\n',
        'data: {"type":"done","duration_ms":321}\n\n'
      ])
    )

    const fullText = await sendV3ChatStream(
      [{ role: 'user', content: '湖北大学附近有什么' }],
      onChunk,
      { requestId: 'req_v3_001' },
      [],
      onMeta
    )

    expect(fullText).toBe('推荐先看湖北大学周边。')
    expect(onChunk).toHaveBeenCalledWith('推荐先看湖北大学周边。')
    expect(onMeta).toHaveBeenCalledWith('trace', expect.objectContaining({ trace_id: 'trace_v3_001' }))
    expect(onMeta).toHaveBeenCalledWith('stage', expect.objectContaining({ name: 'reasoning', label: '空间推理' }))
    expect(onMeta).toHaveBeenCalledWith('pois', [
      expect.objectContaining({ id: 1, name: '湖北大学', lon: 114.35, lat: 30.55 })
    ])
    expect(onMeta).toHaveBeenCalledWith('stats', expect.objectContaining({ result_count: 1 }))
    expect(onMeta).toHaveBeenCalledWith('refined_result', expect.objectContaining({
      results: expect.objectContaining({
        boundary: expect.any(Object),
        spatial_clusters: expect.any(Object)
      })
    }))
    expect(onMeta).toHaveBeenCalledWith('reasoning', expect.objectContaining({ content: '先确定锚点，再筛选候选。' }))
    expect(onMeta).toHaveBeenCalledWith('done', expect.objectContaining({ duration_ms: 321 }))
  })

  it('emits schema_error for invalid structured events instead of silently accepting them', async () => {
    const onChunk = vi.fn()
    const onMeta = vi.fn()

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'data: {"type":"stage","label":"缺少 name 字段"}\n\n',
        'data: {"type":"text","content":"仍然继续输出正文"}\n\n'
      ])
    )

    const fullText = await sendV3ChatStream(
      [{ role: 'user', content: '测试 schema 校验' }],
      onChunk,
      { requestId: 'req_v3_schema_001' },
      [],
      onMeta
    )

    expect(fullText).toBe('仍然继续输出正文')
    expect(onMeta).toHaveBeenCalledWith('schema_error', expect.objectContaining({
      event: 'stage',
      errors: expect.any(Array)
    }))
    expect(onMeta).not.toHaveBeenCalledWith('stage', expect.anything())
  })
})
