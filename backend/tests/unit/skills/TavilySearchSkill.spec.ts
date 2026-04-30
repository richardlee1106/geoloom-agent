import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSkillExecutionContext } from '../../../src/skills/SkillContext.js'
import { createTavilySearchSkill } from '../../../src/skills/tavily_search/TavilySearchSkill.js'

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

describe('TavilySearchSkill', () => {
  it('fails over to the next Tavily key when the primary key is exhausted', async () => {
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
          answer: '可用摘要',
          results: [
            {
              title: '武昌万象城',
              content: '武昌万象城是徐东片区的重要商业综合体。',
              url: 'https://example.com/mixc',
              score: 0.9,
            },
          ],
        },
      })
    }) as typeof fetch

    const skill = createTavilySearchSkill({
      apiKeys: ['tvly-bad', 'tvly-good'],
      timeoutMs: 5000,
    })
    const context = createSkillExecutionContext()

    const result = await skill.execute('search_web', {
      query: '武昌万象城 武汉 购物中心',
    }, context)

    expect(result.ok).toBe(true)
    const data = result.ok ? result.data : null
    expect(data).toMatchObject({
      answer: '可用摘要',
      results: [
        {
          title: '武昌万象城',
          url: 'https://example.com/mixc',
        },
      ],
    })
    expect(seenKeys).toEqual(['tvly-bad', 'tvly-good'])
  })

  it('returns an explicit error after all Tavily keys fail instead of faking empty results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({
      ok: false,
      status: 432,
    })) as typeof fetch

    const skill = createTavilySearchSkill({
      apiKeys: ['tvly-bad-1', 'tvly-bad-2'],
      timeoutMs: 5000,
    })
    const context = createSkillExecutionContext()

    const result = await skill.execute('search_web', {
      query: '销品茂 武汉 购物中心',
    }, context)

    expect(result.ok).toBe(false)
    const error = result.ok ? null : result.error
    expect(error).toMatchObject({
      code: 'tavily_request_failed',
    })
    expect(String(error?.message || '')).toContain('HTTP 432')
  })
})
