#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(filepath) {
  if (!existsSync(filepath)) return
  const text = readFileSync(filepath, 'utf8')
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/gu, '')
    if (!process.env[key]) process.env[key] = value
  }
}

function baseUrlCandidates(raw) {
  const base = String(raw || '').trim().replace(/\/+$/u, '')
  if (!base) return []
  return base.endsWith('/v1') ? [base] : [base, `${base}/v1`]
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1]?.trim()
  const candidate = fenced || trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function normalizeResults(parsed, content) {
  const rawResults = Array.isArray(parsed?.results) ? parsed.results : []
  const results = []
  const seen = new Set()
  for (const item of rawResults) {
    if (!item || typeof item !== 'object') continue
    const url = String(item.url || item.link || item.source_url || '').trim()
    if (!/^https?:\/\//iu.test(url) || seen.has(url)) continue
    seen.add(url)
    results.push({
      title: String(item.title || item.name || url).trim(),
      content: String(item.content || item.snippet || item.summary || item.text || '').trim(),
      url,
    })
  }
  const urlMatches = [...String(content || '').matchAll(/https?:\/\/[^\s)\]"'，。]+/giu)].map((match) => match[0])
  for (const url of urlMatches) {
    if (!seen.has(url)) {
      seen.add(url)
      results.push({ title: url, content: '', url })
    }
  }
  return results
}

async function requestOnce(baseUrl, apiKey, model, query) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_SEARCH_TIMEOUT_MS || process.env.NEWAPI_SEARCH_TIMEOUT_MS || '25000'))
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: '你是联网搜索测试器。请返回严格 JSON，不要使用 markdown。' },
          {
            role: 'user',
            content: `联网搜索：${query}\n请返回 JSON：{"answer":"一句话结论","results":[{"title":"网页标题","content":"摘要","url":"https://..."}]}。results 必须是真实可访问网页 URL，没有 URL 的结果不要返回。`,
          },
        ],
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, body: text.slice(0, 500) }
    }
    const json = JSON.parse(text)
    const content = String(json.choices?.[0]?.message?.content || '')
    const parsed = extractJsonObject(content)
    const results = normalizeResults(parsed, content)
    return {
      ok: true,
      status: response.status,
      answer: String(parsed?.answer || '').trim(),
      content,
      results,
      usage: json.usage || null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function requestWithFallback(apiKey, model, query) {
  const candidates = baseUrlCandidates(process.env.DEEPSEEK_SEARCH_BASE_URL || process.env.NEWAPI_SEARCH_BASE_URL)
  let last = null
  for (const baseUrl of candidates) {
    const started = Date.now()
    try {
      const result = await requestOnce(baseUrl, apiKey, model, query)
      result.baseUrl = baseUrl
      result.latencyMs = Date.now() - started
      if (result.ok) return result
      last = result
      console.log(`- ${baseUrl} 返回 HTTP ${result.status}，尝试下一个地址`)
    } catch (error) {
      last = { ok: false, baseUrl, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started }
      console.log(`- ${baseUrl} 请求失败：${last.error}`)
    }
  }
  return last
}

loadEnvFile(resolve(process.cwd(), '.env'))
loadEnvFile(resolve(process.cwd(), '.env.v4'))
loadEnvFile(resolve(process.cwd(), 'backend', '.env'))

const apiKey = String(process.env.DEEPSEEK_SEARCH_API_KEY || process.env.NEWAPI_SEARCH_API_KEY || '').trim()
const model = String(process.env.DEEPSEEK_SEARCH_MODEL || process.env.NEWAPI_SEARCH_MODEL || '').trim()
const baseUrl = String(process.env.DEEPSEEK_SEARCH_BASE_URL || process.env.NEWAPI_SEARCH_BASE_URL || '').trim()
const queries = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['武汉大学 官方 简介', '沙湖公园 武汉 官方 介绍', '武昌江滩公园 武汉 介绍']

if (!baseUrl || !apiKey || !model) {
  console.error('缺少 DEEPSEEK_SEARCH_BASE_URL / DEEPSEEK_SEARCH_API_KEY / DEEPSEEK_SEARCH_MODEL')
  process.exit(1)
}

console.log('DeepSeek Search 探针')
console.log(`baseUrl=${baseUrl}`)
console.log(`model=${model}`)
console.log(`queries=${queries.length}`)

let usableCount = 0
const summaries = []
for (const query of queries) {
  console.log(`\n查询：${query}`)
  const result = await requestWithFallback(apiKey, model, query)
  if (!result?.ok) {
    console.log('结果：失败')
    console.log(JSON.stringify(result, null, 2))
    summaries.push({ query, ok: false, latencyMs: result?.latencyMs ?? null, urls: 0 })
    continue
  }
  const urls = result.results.map((item) => item.url)
  if (urls.length > 0) usableCount += 1
  summaries.push({ query, ok: true, latencyMs: result.latencyMs, urls: urls.length, baseUrl: result.baseUrl })
  console.log(`结果：成功 base=${result.baseUrl} latency=${result.latencyMs}ms urls=${urls.length}`)
  if (result.answer) console.log(`answer=${result.answer.slice(0, 160)}`)
  for (const [index, item] of result.results.slice(0, 5).entries()) {
    console.log(`${index + 1}. ${item.title || '(无标题)'}`)
    console.log(`   ${item.url}`)
    if (item.content) console.log(`   ${item.content.slice(0, 160)}`)
  }
  if (urls.length === 0) {
    console.log(`raw=${result.content.slice(0, 500)}`)
  }
}

console.log(`\n结论：${usableCount}/${queries.length} 个查询返回了可核验 URL。`)
console.log('耗时汇总：')
for (const item of summaries) {
  console.log(`- ${item.ok ? '成功' : '失败'} | ${item.latencyMs ?? '-'}ms | urls=${item.urls} | ${item.query}`)
}
process.exit(usableCount > 0 ? 0 : 2)
