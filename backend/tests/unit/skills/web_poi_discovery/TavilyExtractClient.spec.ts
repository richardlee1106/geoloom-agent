import { afterEach, describe, expect, it, vi } from 'vitest'

import { TavilyExtractClient } from '../../../../src/skills/web_poi_discovery/tavilyExtractClient.js'

const originalFetch = globalThis.fetch

function mockResponse(input: {
  ok: boolean
  status: number
  jsonBody?: unknown
  textBody?: string
}) {
  return {
    ok: input.ok,
    status: input.status,
    json: async () => input.jsonBody,
    text: async () => input.textBody || '',
  } as Response
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('TavilyExtractClient', () => {
  it('fails over to the next Tavily key when extract hits an exhausted key', async () => {
    const seenKeys: string[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      const apiKey = String(body.api_key || '')
      seenKeys.push(apiKey)

      if (apiKey === 'tvly-bad') {
        return mockResponse({
          ok: false,
          status: 432,
        })
      }

      return mockResponse({
        ok: true,
        status: 200,
        jsonBody: {
          results: [
            {
              url: 'https://example.com/mixc',
              chunks: [
                {
                  text: '武昌万象城把餐饮、零售和公共停留空间集中在同一条动线上。',
                },
              ],
            },
          ],
          failed: [],
        },
      })
    }) as typeof fetch

    const client = new TavilyExtractClient({
      apiKeys: ['tvly-bad', 'tvly-good'],
      timeoutMs: 5000,
    })

    const result = await client.extract([
      { url: 'https://example.com/mixc', title: '武昌万象城' },
    ], '武昌万象城 武汉 购物中心', 1)

    expect(result.chunks).toEqual([
      {
        url: 'https://example.com/mixc',
        title: '武昌万象城',
        text: '武昌万象城把餐饮、零售和公共停留空间集中在同一条动线上。',
      },
    ])
    expect(result.failedUrls).toEqual([])
    expect(seenKeys).toEqual(['tvly-bad', 'tvly-good'])
  })
})
