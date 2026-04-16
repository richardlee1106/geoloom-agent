/**
 * Tavily 搜索 Skill
 * 默认联网搜索引擎：精准结果 + AI 答案摘要
 * 缓存：10分钟 TTL，max 100 条
 */
import crypto from 'node:crypto'
import type { SkillDefinition, SkillActionDefinition, SkillExecutionResult } from '../types.js'

// ── 缓存 ──
interface CacheEntry { data: unknown; ts: number }
const queryCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 100

function cacheKey(query: string, depth: string): string {
  return crypto.createHash('md5').update(`${query}||${depth}`).digest('hex')
}

function getCached(key: string): unknown | undefined {
  const entry = queryCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.ts > CACHE_TTL_MS) { queryCache.delete(key); return undefined }
  return entry.data
}

function setCache(key: string, data: unknown): void {
  if (queryCache.size >= CACHE_MAX) {
    const keys = [...queryCache.keys()].slice(0, Math.floor(CACHE_MAX * 0.2))
    for (const k of keys) queryCache.delete(k)
  }
  queryCache.set(key, { data, ts: Date.now() })
}

// ── Tavily API ──
const TAVILY_API_URL = 'https://api.tavily.com/search'

interface TavilyResult { title: string; content: string; url: string; score: number }

async function fetchTavily(
  query: string,
  apiKey: string,
  searchDepth: string,
  maxResults: number,
  timeoutMs: number,
): Promise<{ answer?: string; results: TavilyResult[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_answer: true,
      }),
      signal: controller.signal,
    })
    if (!resp.ok) return { results: [] }
    const json = await resp.json() as { answer?: string; results?: TavilyResult[] }
    return { answer: json.answer, results: json.results || [] }
  } catch {
    return { results: [] }
  } finally {
    clearTimeout(timer)
  }
}

// ── Skill 定义 ──
export interface TavilySearchSkillOptions {
  apiKey: string
  timeoutMs?: number
}

export function createTavilySearchSkill(options: TavilySearchSkillOptions): SkillDefinition {
  const timeoutMs = options.timeoutMs || 15000

  const actions: Record<string, SkillActionDefinition> = {
    search_web: {
      name: 'search_web',
      description: 'Tavily 搜索引擎（默认，精准+答案摘要）',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询词' },
          queries: {
            type: 'array',
            description: '候选查询词列表；会按顺序逐个搜索并合并结果',
            items: { type: 'string' },
          },
          search_depth: { type: 'string', description: '搜索深度：basic/advanced', default: 'basic' },
          max_results: { type: 'number', description: '最大结果数', default: 24 },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          results: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  }

  return {
    name: 'tavily_search',
    description: 'Tavily 搜索（默认，精准+AI答案摘要）',
    capabilities: ['search_web'],
    actions,
    async getStatus() {
      return {
        tavily: {
          name: 'tavily',
          ready: Boolean(options.apiKey),
          mode: 'remote' as const,
          degraded: !options.apiKey,
          reason: options.apiKey ? undefined : 'missing_api_key',
        },
      }
    },
    async execute(action: string, payload: unknown, _context: unknown): Promise<SkillExecutionResult> {
      if (action !== 'search_web') {
        return { ok: false, error: { code: 'unknown_action', message: `未知 action: ${action}` }, meta: { action, audited: false } }
      }

      const p = payload as Record<string, unknown>
      const queries = Array.isArray(p.queries)
        ? p.queries.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      const fallbackQuery = String(p.query || '').trim()
      const effectiveQueries = [...new Set([...(queries.length > 0 ? queries : []), ...(fallbackQuery ? [fallbackQuery] : [])])]
        .slice(0, 3)
      if (effectiveQueries.length === 0) {
        return { ok: false, error: { code: 'missing_query', message: '缺少 query 参数' }, meta: { action, audited: false } }
      }

      if (!options.apiKey) {
        return { ok: false, error: { code: 'no_api_key', message: 'Tavily API Key 未配置' }, meta: { action, audited: false } }
      }

      const searchDepth = String(p.search_depth || 'basic')
      const maxResults = Math.max(1, Math.min(Number(p.max_results || 24), 50))

      // 缓存检查
      const cacheQuery = effectiveQueries.join(' || ')
      const ck = cacheKey(cacheQuery, searchDepth)
      const cached = getCached(ck)
      if (cached) {
        return { ok: true, data: cached, meta: { action, audited: false, fromCache: true } }
      }

      let answer = ''
      const mergedMap = new Map<string, TavilyResult>()
      const responses = await Promise.all(
        effectiveQueries.map(async (query) => ({
          query,
          response: await fetchTavily(query, options.apiKey, searchDepth, maxResults, timeoutMs),
        })),
      )
      for (const { query, response } of responses) {
        console.log(`[诊断:Tavily] query="${query}", results=${response.results.length}, hasAnswer=${!!response.answer}`)
        if (!answer && response.answer) {
          answer = response.answer
        }
        for (const result of response.results) {
          const key = result.url || `${result.title}::${result.content}`
          if (!mergedMap.has(key)) {
            mergedMap.set(key, result)
          }
        }
      }
      const results = [...mergedMap.values()].slice(0, maxResults)

      const data = { answer, results }

      if (results.length > 0) setCache(ck, data)

      return { ok: true, data, meta: { action, audited: false } }
    },
  }
}
