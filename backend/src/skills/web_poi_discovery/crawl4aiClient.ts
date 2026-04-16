/**
 * crawl4ai HTTP 客户端
 * 封装 localhost:11235/crawl 接口调用
 */

export interface CrawlContentItem {
  title: string
  url: string
  content: string
}

const DEFAULT_CRAWL4AI_URL = 'http://localhost:11235'

export class Crawl4aiClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env.CRAWL4AI_URL || DEFAULT_CRAWL4AI_URL).replace(/\/+$/, '')
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  async fetchContents(
    urls: Array<{ url: string; title?: string }>,
    timeoutMs = 15000,
  ): Promise<CrawlContentItem[]> {
    if (!urls.length) return []

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      // crawl4ai API: POST /crawl with { urls: [...] }
      const res = await fetch(`${this.baseUrl}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urls.map((u) => u.url),
          priority: 10,
          bypass_cache: false,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        console.warn(`[Crawl4AI] HTTP ${res.status}`)
        return []
      }

      const data = await res.json() as Record<string, unknown>
      return this.extractContents(data, urls)
    } catch (err) {
      console.warn(`[Crawl4AI] 爬取失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  private async extractContents(
    data: Record<string, unknown>,
    urls: Array<{ url: string; title?: string }>,
  ): Promise<CrawlContentItem[]> {
    const results: CrawlContentItem[] = []
    const urlTitleMap = new Map(urls.map((u) => [u.url, u.title || '']))

    // 处理结果数组（同步模式）
    const rawResults = Array.isArray(data.results) ? data.results : []

    if (rawResults.length > 0) {
      for (const item of rawResults as Array<Record<string, unknown>>) {
        const url = String(item.url || '')
        const title = String(item.title || urlTitleMap.get(url) || '')
        const markdown = item.markdown as Record<string, string> | undefined
        const rawMarkdown = markdown?.raw_markdown || markdown?.[Object.keys(markdown || {})[0] || ''] || ''
        const content = String(
          rawMarkdown
          || item.cleaned_html
          || item.html
          || '',
        ).slice(0, 6000)

        if (content.length > 80) {
          results.push({ title, url, content })
        }
      }
      return results
    }

    // 异步模式：检查 task_id 并轮询
    const taskId = String(data.task_id || '')
    if (taskId) {
      return this.pollTask(taskId, urlTitleMap)
    }

    return []
  }

  private async pollTask(
    taskId: string,
    urlTitleMap: Map<string, string | undefined>,
    timeoutMs = 15000,
  ): Promise<CrawlContentItem[]> {
    const start = Date.now()
    const interval = 1000
    const results: CrawlContentItem[] = []

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.baseUrl}/task/${taskId}`)
        if (!res.ok) break

        const task = await res.json() as Record<string, unknown>
        if (task.status === 'completed') {
          const taskResults = Array.isArray(task.results) ? task.results : []
          for (const item of taskResults as Array<Record<string, unknown>>) {
            const url = String(item.url || '')
            const title = String(item.title || urlTitleMap.get(url) || '')
            const markdown = item.markdown as Record<string, string> | undefined
            const rawMarkdown = markdown?.raw_markdown || ''
            const content = String(rawMarkdown || item.cleaned_html || item.html || '').slice(0, 6000)
            if (content.length > 80) {
              results.push({ title, url, content })
            }
          }
          break
        }
      } catch {
        break
      }

      await new Promise((r) => setTimeout(r, interval))
    }

    return results
  }
}
