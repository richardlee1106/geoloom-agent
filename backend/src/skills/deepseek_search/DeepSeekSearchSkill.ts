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

export interface DeepSeekSearchEndpointOptions {
  label?: string
  baseUrl?: string
  apiKey?: string
  model?: string
}

interface DeepSeekSearchEndpoint {
  label: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface DeepSeekSearchSkillOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  timeoutMs?: number
  endpoints?: DeepSeekSearchEndpointOptions[]
}

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 100
const queryCache = new Map<string, CacheEntry>()

function normalizeBaseUrl(value: unknown): string {
  const raw = String(value || '').trim().replace(/\/+$/u, '')
  if (!raw) return ''
  return raw.endsWith('/v1') ? raw : `${raw}/v1`
}

function cacheKey(query: string, endpoint: DeepSeekSearchEndpoint): string {
  return crypto.createHash('md5').update(`${endpoint.baseUrl}||${endpoint.model}||${query}`).digest('hex')
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

function resolveEndpoint(input: DeepSeekSearchEndpointOptions, label: string): DeepSeekSearchEndpoint | null {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const apiKey = String(input.apiKey || '').trim()
  const model = String(input.model || '').trim()
  if (!baseUrl || !apiKey || !model) return null
  return {
    label: input.label || label,
    baseUrl,
    apiKey,
    model,
  }
}

function uniqueEndpoints(endpoints: DeepSeekSearchEndpoint[]): DeepSeekSearchEndpoint[] {
  const seen = new Set<string>()
  const unique: DeepSeekSearchEndpoint[] = []
  for (const endpoint of endpoints) {
    const key = `${endpoint.baseUrl}||${endpoint.apiKey}||${endpoint.model}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(endpoint)
  }
  return unique
}

function resolveSearchEndpoints(options: DeepSeekSearchSkillOptions): DeepSeekSearchEndpoint[] {
  const configured = options.endpoints?.length
    ? options.endpoints
    : [
      {
        label: 'primary',
        baseUrl: process.env.DEEPSEEK_SEARCH_PRIMARY_BASE_URL,
        apiKey: process.env.DEEPSEEK_SEARCH_PRIMARY_API_KEY,
        model: process.env.DEEPSEEK_SEARCH_PRIMARY_MODEL,
      },
      {
        label: 'default',
        baseUrl: options.baseUrl || process.env.DEEPSEEK_SEARCH_BASE_URL || process.env.NEWAPI_SEARCH_BASE_URL,
        apiKey: options.apiKey || process.env.DEEPSEEK_SEARCH_API_KEY || process.env.NEWAPI_SEARCH_API_KEY,
        model: options.model || process.env.DEEPSEEK_SEARCH_MODEL || process.env.NEWAPI_SEARCH_MODEL,
      },
    ]
  return uniqueEndpoints(configured.map((endpoint, index) => resolveEndpoint(endpoint, `endpoint_${index + 1}`)).filter((endpoint): endpoint is DeepSeekSearchEndpoint => Boolean(endpoint)))
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
  const endpoints = resolveSearchEndpoints(options)
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
      const primary = endpoints[0]
      return {
        deepseek_search: {
          name: 'deepseek_search',
          ready: endpoints.length > 0,
          degraded: endpoints.length === 0,
          mode: endpoints.length > 0 ? 'remote' as const : 'unconfigured' as const,
          reason: endpoints.length > 0 ? undefined : 'missing_deepseek_search_env',
          target: primary?.baseUrl || null,
          details: {
            primary: primary ? { label: primary.label, baseUrl: primary.baseUrl, model: primary.model } : null,
            fallbackCount: Math.max(endpoints.length - 1, 0),
          },
        },
      }
    },
    async execute(action: string, payload: unknown): Promise<SkillExecutionResult<DeepSeekSearchData>> {
      const start = Date.now()
      if (action !== 'search_web') {
        return { ok: false, error: { code: 'unknown_action', message: `未知 action: ${action}` }, meta: { action, audited: false, latencyMs: Date.now() - start } }
      }
      if (endpoints.length === 0) {
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
      const failures: Array<{ label: string; baseUrl: string; model: string; message: string }> = []
      for (const endpoint of endpoints) {
        const key = cacheKey(query, endpoint)
        const cached = getCached(key)
        if (cached) {
          return { ok: true, data: cached, meta: { action, audited: false, fromCache: true, endpointLabel: endpoint.label, endpointBaseUrl: endpoint.baseUrl, endpointModel: endpoint.model, latencyMs: Date.now() - start } }
        }
        try {
          const data = await requestDeepSeekSearch({ baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey, model: endpoint.model, query, maxResults, timeoutMs })
          if (data.results.length > 0) setCached(key, data)
          return { ok: true, data, meta: { action, audited: true, endpointLabel: endpoint.label, endpointBaseUrl: endpoint.baseUrl, endpointModel: endpoint.model, fallbackAttempts: failures.length, latencyMs: Date.now() - start, resultCount: data.results.length } }
        } catch (error) {
          failures.push({ label: endpoint.label, baseUrl: endpoint.baseUrl, model: endpoint.model, message: error instanceof Error ? error.message : String(error) })
        }
      }
      const message = failures.map((failure) => `${failure.label}@${failure.baseUrl}: ${failure.message}`).join(' | ')
      return { ok: false, error: { code: 'deepseek_search_failed', message, details: failures }, meta: { action, audited: false, latencyMs: Date.now() - start, fallbackAttempts: failures.length } }
    },
  }
}
