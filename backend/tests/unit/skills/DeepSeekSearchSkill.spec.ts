import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSkillExecutionContext } from '../../../src/skills/SkillContext.js'
import { createDeepSeekSearchSkill } from '../../../src/skills/deepseek_search/DeepSeekSearchSkill.js'

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

describe('DeepSeekSearchSkill', () => {
  it('tries the primary endpoint first and falls back to the default endpoint', async () => {
    const seenRequests: Array<{ url: string; model: string }> = []
    globalThis.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      const model = String(body.model || '')
      seenRequests.push({ url: String(url), model })

      if (model === 'deepseek-chat-search') {
        return mockResponse({ ok: false, status: 502, textBody: 'primary unavailable' })
      }

      return mockResponse({
        ok: true,
        status: 200,
        jsonBody: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: 'fallback 可用',
                  results: [
                    {
                      title: '武汉大学',
                      content: '武汉大学是武汉重要的教育文化地标。',
                      url: 'https://example.com/wuhan-university',
                      score: 0.91,
                    },
                  ],
                }),
              },
            },
          ],
        },
      })
    }) as typeof fetch

    const skill = createDeepSeekSearchSkill({
      timeoutMs: 5000,
      endpoints: [
        {
          label: 'primary',
          baseUrl: 'https://ciyuanshen.top/v1',
          apiKey: 'primary-key',
          model: 'deepseek-chat-search',
        },
        {
          label: 'default',
          baseUrl: 'https://api.deepsb.com',
          apiKey: 'fallback-key',
          model: 'deepseek-v4-flash-search-nothinking',
        },
      ],
    })
    const context = createSkillExecutionContext()

    const result = await skill.execute('search_web', {
      query: 'DeepSeek fallback 单元测试 武汉大学',
      max_results: 3,
    }, context)

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      answer: 'fallback 可用',
      model: 'deepseek-v4-flash-search-nothinking',
      results: [
        {
          title: '武汉大学',
          url: 'https://example.com/wuhan-university',
        },
      ],
    })
    expect(result.meta).toMatchObject({
      endpointLabel: 'default',
      endpointBaseUrl: 'https://api.deepsb.com/v1',
      endpointModel: 'deepseek-v4-flash-search-nothinking',
      fallbackAttempts: 1,
    })
    expect(seenRequests).toEqual([
      { url: 'https://ciyuanshen.top/v1/chat/completions', model: 'deepseek-chat-search' },
      { url: 'https://api.deepsb.com/v1/chat/completions', model: 'deepseek-v4-flash-search-nothinking' },
    ])
  })

  it('reports primary endpoint and fallback count in dependency status', async () => {
    const skill = createDeepSeekSearchSkill({
      endpoints: [
        {
          label: 'primary',
          baseUrl: 'https://ciyuanshen.top/v1',
          apiKey: 'primary-key',
          model: 'deepseek-chat-search',
        },
        {
          label: 'default',
          baseUrl: 'https://api.deepsb.com/v1',
          apiKey: 'fallback-key',
          model: 'deepseek-v4-flash-search-nothinking',
        },
      ],
    })

    const status = await skill.getStatus?.()

    expect(status?.deepseek_search).toMatchObject({
      ready: true,
      degraded: false,
      target: 'https://ciyuanshen.top/v1',
      details: {
        primary: {
          label: 'primary',
          baseUrl: 'https://ciyuanshen.top/v1',
          model: 'deepseek-chat-search',
        },
        fallbackCount: 1,
      },
    })
  })
})
