/**
 * MentionExtractor — LLM 结构化 mention 提取
 *
 * 用小模型从 Tavily Extract 返回的 chunk 中并发提取结构化 mention JSON。
 * 替代 NER + 正则方案。
 */

import type { ExtractedChunkItem, WebMention } from './types.js'

export interface MentionExtractorOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
}

const MENTION_EXTRACTION_SYSTEM_PROMPT = `你是一个专业的POI名称提取器。从网页片段中提取被明确提及的真实店名/景点名/机构名。

核心原则：
- 优先提取具体的商家/店铺/景点名称（如"星巴克"、"瑞幸咖啡"、"黄鹤楼"）
- 不要提取城市名、区域名、大学名等地理区域词（如"武汉"、"武昌"、"武汉大学"）
- 不要提取泛词（如"推荐景点"、"附近好吃的"），标记 is_generic=true

规则：
1. 只提取被明确提及的具体名称，不要推测或编造
2. 每个名称必须附带原文中的证据短语（evidence_span）
3. 如果能从上下文判断区域，填入 area_hint（如"汉口"、"武昌"）
4. 如果能判断品类，填入 category_hint（如"咖啡馆"、"火锅店"）
5. confidence 反映你对这个名称确实是真实POI的把握程度

返回 JSON 数组，每个元素格式：
{
  "mention": "店名/景点名",
  "evidence_span": "原文中出现的片段",
  "area_hint": "区域提示或空字符串",
  "category_hint": "品类提示或空字符串",
  "confidence": 0.0到1.0,
  "is_generic": false
}

如果没有发现任何具体店名/景点名，返回空数组 []`

interface RawMentionItem {
  mention?: string
  evidence_span?: string
  area_hint?: string
  category_hint?: string
  confidence?: number
  is_generic?: boolean
}

export class MentionExtractor {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: MentionExtractorOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.model = options.model
    this.timeoutMs = options.timeoutMs || 4000
  }

  /**
   * 并发从多个 chunk 中提取 mention
   *
   * @param chunks Tavily Extract 返回的文本片段
   * @param query 用户原始查询（作为上下文）
   * @param concurrency 最大并发数
   */
  async extractMentions(
    chunks: ExtractedChunkItem[],
    query: string,
    concurrency = 6,
    categoryHint = '',
  ): Promise<{ mentions: WebMention[]; latencyMs: number }> {
    if (!this.baseUrl || !this.apiKey || !this.model) {
      return { mentions: [], latencyMs: 0 }
    }

    const start = Date.now()
    const allMentions: WebMention[] = []

    // 分批并发处理
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
      while (cursor < chunks.length) {
        const idx = cursor++
        const chunk = chunks[idx]
        if (!chunk) continue

        try {
          const mentions = await this.extractFromSingleChunk(chunk, query, categoryHint)
          allMentions.push(...mentions)
        } catch (err) {
          console.warn(
            `[MentionExtractor] chunk 提取失败(${chunk.url}): ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    })

    await Promise.all(workers)

    return { mentions: allMentions, latencyMs: Date.now() - start }
  }

  private async extractFromSingleChunk(
    chunk: ExtractedChunkItem,
    query: string,
    categoryHint = '',
  ): Promise<WebMention[]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const userMessage = [
        `用户查询: ${query}`,
        categoryHint ? `目标品类: ${categoryHint}（请重点提取该品类的具体店名）` : '',
        `网页标题: ${chunk.title}`,
        `网页片段:`,
        chunk.text.slice(0, 900),
      ].filter(Boolean).join('\n')

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: MENTION_EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          temperature: 0,
          max_tokens: 200,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        return []
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }

      const content = String(data.choices?.[0]?.message?.content || '').trim()
      if (!content) return []

      return this.parseMentionResponse(content, chunk)
    } catch {
      clearTimeout(timer)
      return []
    }
  }

  private parseMentionResponse(
    content: string,
    chunk: ExtractedChunkItem,
  ): WebMention[] {
    // 尝试提取 JSON（可能被包裹在 code block 中）
    let jsonText = content
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1] || ''
    }

    // 尝试找到 JSON 数组
    const arrayStart = jsonText.indexOf('[')
    const arrayEnd = jsonText.lastIndexOf(']')
    if (arrayStart === -1 || arrayEnd === -1 || arrayEnd < arrayStart) {
      return []
    }

    let rawItems: RawMentionItem[]
    try {
      rawItems = JSON.parse(jsonText.slice(arrayStart, arrayEnd + 1)) as RawMentionItem[]
    } catch {
      return []
    }

    if (!Array.isArray(rawItems)) return []

    return rawItems
      .filter((item) => item.mention && typeof item.mention === 'string')
      .map((item) => ({
        mention: String(item.mention || '').trim(),
        evidenceSpan: String(item.evidence_span || '').trim(),
        pageTitle: chunk.title,
        url: chunk.url,
        areaHint: String(item.area_hint || '').trim(),
        categoryHint: String(item.category_hint || '').trim(),
        confidence: Math.min(Math.max(Number(item.confidence) || 0.5, 0), 1),
        isGeneric: Boolean(item.is_generic),
      }))
      .filter((m) => m.mention.length >= 2 && m.mention.length <= 30)
  }
}
