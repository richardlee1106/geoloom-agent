/**
 * Tavily Extract 客户端 — 替代 crawl4ai
 *
 * 调用 Tavily Extract API，支持 query 参数做 chunk rerank，
 * 支持 chunks_per_source 控制每个网页返回的片段数。
 *
 * API 文档: https://docs.tavily.com/documentation/api-reference/endpoint/extract
 */

import type { ExtractedChunkItem } from './types.js'

export type { ExtractedChunkItem }

export interface TavilyExtractOptions {
  apiKey: string
  timeoutMs?: number
}

export interface ExtractUrlInput {
  url: string
  title?: string
}

export interface TavilyExtractResponse {
  chunks: ExtractedChunkItem[]
  failedUrls: string[]
  latencyMs: number
}

export class TavilyExtractClient {
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(options: TavilyExtractOptions) {
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs || 15000
  }

  /**
   * 批量提取 URL 内容
   *
   * @param urls 目标 URL 列表（最多 20 个）
   * @param query 用于 chunk rerank 的查询文本，让 API 返回最相关的片段
   * @param chunksPerSource 每个网页返回几个最相关的片段（1-5）
   */
  async extract(
    urls: ExtractUrlInput[],
    query: string,
    chunksPerSource = 3,
  ): Promise<TavilyExtractResponse> {
    if (!this.apiKey) {
      return { chunks: [], failedUrls: urls.map((u) => u.url), latencyMs: 0 }
    }

    const start = Date.now()
    const urlStrings = urls.slice(0, 20).map((u) => u.url)
    const titleMap = new Map(urls.map((u) => [u.url, u.title || '']))

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

      const body: Record<string, unknown> = {
        api_key: this.apiKey,
        urls: urlStrings,
        extract_depth: 'basic',
        format: 'markdown',
      }

      // 带查询参数时，让 API 按 query 相关性重排 chunk
      if (query) {
        body.query = query
        body.chunks_per_source = Math.min(Math.max(chunksPerSource, 1), 5)
      }

      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.warn(`[TavilyExtract] HTTP ${res.status}: ${errText.slice(0, 200)}`)
        return {
          chunks: [],
          failedUrls: urlStrings,
          latencyMs: Date.now() - start,
        }
      }

      const data = await res.json() as {
        results?: Array<{
          url?: string
          raw_content?: string
          text?: string
          chunks?: Array<{ text?: string }>
        }>
        failed?: Array<{ url?: string }>
      }

      const chunks: ExtractedChunkItem[] = []
      const failedUrls: string[] = []
      const succeededUrls = new Set<string>()

      for (const result of data.results || []) {
        const url = String(result.url || '')
        if (!url) continue
        succeededUrls.add(url)

        const title = titleMap.get(url) || ''
        const textPieces: string[] = []

        // 优先用 chunks（query 模式返回的片段）
        if (Array.isArray(result.chunks) && result.chunks.length > 0) {
          for (const chunk of result.chunks) {
            const text = String(chunk.text || '').trim()
            if (text) textPieces.push(text)
          }
        }

        // 降级到 raw_content / text
        if (textPieces.length === 0) {
          const rawText = String(result.raw_content || result.text || '').trim()
          if (rawText) textPieces.push(rawText.slice(0, 4000))
        }

        for (const text of textPieces) {
          if (text.length > 20) {
            chunks.push({ url, title, text })
          }
        }
      }

      // 收集失败 URL
      for (const item of data.failed || []) {
        if (item.url) failedUrls.push(item.url)
      }
      for (const url of urlStrings) {
        if (!succeededUrls.has(url) && !failedUrls.includes(url)) {
          failedUrls.push(url)
        }
      }

      return { chunks, failedUrls, latencyMs: Date.now() - start }
    } catch (err) {
      console.warn(`[TavilyExtract] 请求失败: ${err instanceof Error ? err.message : String(err)}`)
      return {
        chunks: [],
        failedUrls: urlStrings,
        latencyMs: Date.now() - start,
      }
    }
  }
}
