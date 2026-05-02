import crypto from 'node:crypto'

import type { SkillDefinition, SkillExecutionResult } from '../types.js'

interface CacheEntry { data: DeepSeekSearchData; ts: number }

interface DeepSeekSearchResult {
  title: string
  content: string
  url: string
  score?: number
}

interface DeepSeekSearchData {
  answer: string
  results: DeepSeekSearchResult[]
  provider: 'deepseek_search'
  model: string
}

export interface DeepSeekSearchSkillOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  timeoutMs?: number
}

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 100
const queryCache = new Map<string, CacheEntry>()

function normalizeBaseUrl(value: unknown): string {
  const raw = String(value || '').trim().replace(/\/+$/u, '')
  if (!raw) return ''
  return raw.endsWith('/v1') ? raw : `${raw}/v1`
}

function cacheKey(query: string, model: string): string {
  return crypto.createHash('md5').update(`${model}||${query}`).digest('hex')
}

function getCached(key: string): DeepSeekSearchData | undefined {
  const entry = queryCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    queryCache.delete(key)
    return undefined
  }
  return entry.data
}

function setCached(key: string, data: DeepSeekSearchData) {
  if (queryCache.size >= CACHE_MAX) {
    for (const keyToDelete of [...queryCache.keys()].slice(0, Math.floor(CACHE_MAX * 0.2))) {
      queryCache.delete(keyToDelete)
    }
  }
  queryCache.set(key, { data, ts: Date.now() })
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1]?.trim()
  const candidate = fenced || trimmed
  try {
    return JSON.parse(candidate) as Record<string, unknown>
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function normalizeResults(value: unknown, maxResults: number): DeepSeekSearchResult[] {
  if (!Array.isArray(value)) return []
  const results: DeepSeekSearchResult[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const url = String(raw.url || raw.link || raw.source_url || '').trim()
    if (!/^https?:\/\//iu.test(url) || seen.has(url)) continue
    const title = String(raw.title || raw.name || url).trim().slice(0, 160)
    const content = String(raw.content || raw.snippet || raw.summary || raw.text || '').trim().slice(0, 600)
    if (!title && !content) continue
    const score = Number(raw.score ?? raw.relevance ?? 0.8)
    seen.add(url)
    results.push({ title: title || url, content, url, score: Number.isFinite(score) ? score : 0.8 })
    if (results.length >= maxResults) break
  }
  return results
}

function buildSearchPrompt(query: string, maxResults: number): string {
  return [
    '请联网检索这个地理/城市空间主题，并只返回 JSON。',
    '不要编造 URL；没有可核验 URL 的条目不要放入 results。',
    '每条结果用于地图解说的 web fact grounding，应优先选择官方、百科、新闻、旅游介绍、机构页面。',
    `最多返回 ${maxResults} 条。`,
    'JSON 格式：{"answer":"一句话结论","results":[{"title":"标题","content":"摘要","url":"https://...","score":0.8}]}',
    `查询：${query}`,
  ].join('\n')
}

async function requestDeepSeekSearch(input: {
  baseUrl: string
  apiKey: string
  model: string
  query: string
  maxResults: number
  timeoutMs: number
}): Promise<DeepSeekSearchData> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: '你是 web fact 搜索适配器。你必须输出严格 JSON，并且只保留有 URL 的可核验网页来源。',
          },
          { role: 'user', content: buildSearchPrompt(input.query, input.maxResults) },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`DeepSeek search request failed with HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = String(json.choices?.[0]?.message?.content || '')
    const parsed = extractJsonObject(content)
    const results = normalizeResults(parsed?.results, input.maxResults)
    return {
      answer: String(parsed?.answer || '').trim(),
      results,
      provider: 'deepseek_search',
      model: input.model,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function createDeepSeekSearchSkill(options: DeepSeekSearchSkillOptions = {}): SkillDefinition {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.DEEPSEEK_SEARCH_BASE_URL || process.env.NEWAPI_SEARCH_BASE_URL)
  const apiKey = String(options.apiKey || process.env.DEEPSEEK_SEARCH_API_KEY || process.env.NEWAPI_SEARCH_API_KEY || '').trim()
  const model = String(options.model || process.env.DEEPSEEK_SEARCH_MODEL || process.env.NEWAPI_SEARCH_MODEL || '').trim()
  const timeoutMs = Number(options.timeoutMs || process.env.DEEPSEEK_SEARCH_TIMEOUT_MS || process.env.NEWAPI_SEARCH_TIMEOUT_MS || '15000')

  return {
    name: 'deepseek_search',
    description: 'DeepSeek 联网搜索适配器，用于 narrative web fact 来源补强',
    capabilities: ['search_web'],
    actions: {
      search_web: {
        name: 'search_web',
        description: '通过 DeepSeek 搜索接口获取带 URL 的 web fact 候选',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询词' },
            queries: { type: 'array', items: { type: 'string' }, description: '候选查询词列表' },
            max_results: { type: 'number', description: '最大结果数' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            results: { type: 'array', items: { type: 'object' } },
            provider: { type: 'string' },
            model: { type: 'string' },
          },
        },
      },
    },
    async getStatus() {
      return {
        deepseek_search: {
          name: 'deepseek_search',
          ready: Boolean(baseUrl && apiKey && model),
          degraded: !(baseUrl && apiKey && model),
          mode: 'remote' as const,
          reason: baseUrl && apiKey && model ? undefined : 'missing_deepseek_search_env',
          details: { baseUrl: baseUrl || null, model: model || null },
        },
      }
    },
    async execute(action: string, payload: unknown): Promise<SkillExecutionResult<DeepSeekSearchData>> {
      const start = Date.now()
      if (action !== 'search_web') {
        return { ok: false, error: { code: 'unknown_action', message: `未知 action: ${action}` }, meta: { action, audited: false, latencyMs: Date.now() - start } }
      }
      if (!baseUrl || !apiKey || !model) {
        return { ok: false, error: { code: 'missing_deepseek_search_env', message: 'DEEPSEEK_SEARCH_BASE_URL / DEEPSEEK_SEARCH_API_KEY / DEEPSEEK_SEARCH_MODEL 未完整配置' }, meta: { action, audited: false, latencyMs: Date.now() - start } }
      }
      const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const queries = Array.isArray(raw.queries) ? raw.queries.map((item) => String(item || '').trim()).filter(Boolean) : []
      const fallbackQuery = String(raw.query || '').trim()
      const query = queries[0] || fallbackQuery
      if (!query) {
        return { ok: false, error: { code: 'missing_query', message: '缺少 query 参数' }, meta: { action, audited: false, latencyMs: Date.now() - start } }
      }
      const maxResults = Math.max(1, Math.min(Number(raw.max_results || 5), 10))
      const key = cacheKey(query, model)
      const cached = getCached(key)
      if (cached) {
        return { ok: true, data: cached, meta: { action, audited: false, fromCache: true, latencyMs: Date.now() - start } }
      }
      try {
        const data = await requestDeepSeekSearch({ baseUrl, apiKey, model, query, maxResults, timeoutMs })
        if (data.results.length > 0) setCached(key, data)
        return { ok: true, data, meta: { action, audited: true, latencyMs: Date.now() - start, resultCount: data.results.length } }
      } catch (error) {
        return { ok: false, error: { code: 'deepseek_search_failed', message: error instanceof Error ? error.message : String(error) }, meta: { action, audited: false, latencyMs: Date.now() - start } }
      }
    },
  }
}
