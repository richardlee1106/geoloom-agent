import { createHash } from 'node:crypto'

import type { LLMProvider, LLMProviderStatus } from '../llm/types.js'
import type { NarrativeChapter, NarrativeCompanionCue, NarrativeCompanionCueKind, NarrativeRegion, NarrativeWebSource } from './contract.js'

export interface NarrativeCompanionCuesDebug {
  used: boolean
  provider?: LLMProviderStatus
  latency_ms?: number
  generated_count?: number
  error?: string
  raw_content_excerpt?: string
}

export interface BuildNarrativeCompanionCuesInput {
  chapter: NarrativeChapter
  region?: NarrativeRegion
  llmProvider?: LLMProvider
  enabled?: boolean
  maxCues?: number
}

export interface BuildNarrativeCompanionCuesResult {
  cues: NarrativeCompanionCue[]
  debug: NarrativeCompanionCuesDebug
}

export interface AttachCompanionCuesInput {
  chapters: NarrativeChapter[]
  regions: NarrativeRegion[]
  llmProvider?: LLMProvider
  enabled?: boolean
  maxCuesPerChapter?: number
}

export interface AttachCompanionCuesResult {
  chapters: NarrativeChapter[]
  debug: NarrativeCompanionCuesDebug
}

const ALLOWED_CUE_KINDS = new Set<NarrativeCompanionCueKind>([
  'visit_info',
  'history_deep_dive',
  'nearby_recommendation',
  'local_way',
  'contrast',
  'fact_check',
  'practical_tip',
])
const GENERIC_BUBBLE_RE = /(了解更多|更多信息|继续了解|想知道更多|展开讲讲|这里有什么特别|有什么特别之处|要不要我继续|想继续听|你感兴趣吗)/iu
const ANSWER_CLAIM_RE = /(开放时间是|门票是|预约方式是|今天开放|现在开放|今天.*开门|免费入馆|票价为|营业到|建于\d{3,4}年)/iu
const WEB_INTENT_RE = /(现在|今天|开放|营业|预约|门票|票价|入馆|参观|展览|路线|怎么去|附近|顺路|攻略|排队)/iu
const JSON_FENCE_RE = /^```(?:json)?\s*|\s*```$/giu

export async function attachCompanionCuesToChapters(input: AttachCompanionCuesInput): Promise<AttachCompanionCuesResult> {
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  const enabled = input.enabled ?? resolveNarrativeCompanionCuesEnabled()
  const providerStatus = input.llmProvider?.getStatus()
  if (!enabled || !input.llmProvider || !input.llmProvider.isReady()) {
    return {
      chapters: input.chapters.map((chapter) => ({ ...chapter, companion_cues: chapter.companion_cues ?? [] })),
      debug: {
        used: false,
        provider: providerStatus,
        generated_count: 0,
        error: !enabled ? 'disabled' : !input.llmProvider ? 'no_provider' : 'provider_not_ready',
      },
    }
  }

  const started = Date.now()
  const results = await Promise.all(input.chapters.map((chapter) => buildNarrativeCompanionCues({
    chapter,
    region: regionById.get(chapter.region_id),
    llmProvider: input.llmProvider,
    enabled,
    maxCues: input.maxCuesPerChapter,
  })))
  const chapters = input.chapters.map((chapter, index) => ({ ...chapter, companion_cues: results[index]?.cues ?? [] }))
  const errors = results.map((result) => result.debug.error).filter(Boolean)
  const generatedCount = results.reduce((acc, result) => acc + result.cues.length, 0)
  return {
    chapters,
    debug: {
      used: true,
      provider: providerStatus,
      latency_ms: Date.now() - started,
      generated_count: generatedCount,
      error: errors.length ? errors.join(' | ') : undefined,
    },
  }
}

export async function buildNarrativeCompanionCues(input: BuildNarrativeCompanionCuesInput): Promise<BuildNarrativeCompanionCuesResult> {
  const enabled = input.enabled ?? resolveNarrativeCompanionCuesEnabled()
  const provider = input.llmProvider
  const providerStatus = provider?.getStatus()
  const maxCues = Math.max(0, Math.min(input.maxCues ?? resolveCompanionCueMaxPerChapter(), 4))
  const chapterText = normalizeText(input.chapter.text)
  if (!enabled || maxCues <= 0 || chapterText.length < 36 || !provider || !provider.isReady()) {
    return {
      cues: [],
      debug: {
        used: false,
        provider: providerStatus,
        generated_count: 0,
        error: !enabled ? 'disabled' : maxCues <= 0 ? 'max_cues_zero' : chapterText.length < 36 ? 'chapter_too_short' : !provider ? 'no_provider' : 'provider_not_ready',
      },
    }
  }

  const started = Date.now()
  let rawContent = ''
  try {
    const response = await provider.complete({
      messages: [
        { role: 'system', content: buildCompanionCueSystemPrompt() },
        { role: 'user', content: buildCompanionCueUserPrompt(input, maxCues) },
      ],
      tools: [],
      timeoutMs: resolveCompanionCueTimeoutMs(),
      temperature: resolveNumber(process.env.NARRATIVE_COMPANION_CUE_TEMPERATURE, 0.72),
      topP: resolveNumber(process.env.NARRATIVE_COMPANION_CUE_TOP_P, 0.92),
    })
    rawContent = response.assistantMessage.content || ''
    const cues = sanitizeCompanionCues(extractCueArray(rawContent), input.chapter, maxCues)
    return {
      cues,
      debug: {
        used: true,
        provider: providerStatus,
        latency_ms: Date.now() - started,
        generated_count: cues.length,
        raw_content_excerpt: excerpt(rawContent),
      },
    }
  } catch (error) {
    return {
      cues: [],
      debug: {
        used: true,
        provider: providerStatus,
        latency_ms: Date.now() - started,
        generated_count: 0,
        error: error instanceof Error ? error.message : String(error),
        raw_content_excerpt: excerpt(rawContent),
      },
    }
  }
}

function buildCompanionCueSystemPrompt(): string {
  return [
    '你是 GeoLoom 的导览副驾追问候选生成器。',
    '你的任务不是写答案，也不是继续写解说正文，而是阅读刚生成好的章节字幕，挑出用户可能顺手想问的一小步。',
    '只允许基于章节原文、片区资料和来源摘要生成问题；不要编造开放时间、票价、预约方式、路线细节或实时状态。',
    '如果问题需要最新信息，只在 requires_web 标记 true，答案等用户点击后再联网搜索。',
    '每条问题必须绑定章节原文中真实出现的 anchor_text，anchor_text 要能在原文里逐字找到。',
    'bubble_text 要像按钮旁的小气泡，短、自然、具体，不能写“想了解更多吗”这类空话。',
    '输出必须是严格 JSON，不要 Markdown，不要解释。格式：{"cues":[{"bubble_text":"...","prompt":"...","kind":"visit_info|history_deep_dive|nearby_recommendation|local_way|contrast|fact_check|practical_tip","target_entity":"...","anchor_text":"...","requires_web":true,"priority":0.86,"display_after_ms":900}]}',
  ].join('\n')
}

function buildCompanionCueUserPrompt(input: BuildNarrativeCompanionCuesInput, maxCues: number): string {
  const region = input.region
  const sources = (input.chapter.web_sources || []).slice(0, 3).map(cleanWebSourceForPrompt)
  const facts = (region?.narrative_facts || []).filter((fact) => fact.verified).slice(0, 6).map((fact) => fact.claim)
  const places = (region?.pois || [])
    .filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium')
    .slice(0, 10)
    .map((poi) => ({ name: poi.display_name, category: [poi.category_main, poi.category_sub].filter(Boolean).join('/') }))
  return JSON.stringify({
    task: '为这一章字幕生成伴随式补充气泡候选。只生成问题，不生成答案。没有自然延伸点就返回空数组。',
    max_cues: maxCues,
    region: {
      id: input.chapter.region_id,
      name: region?.display_name || input.chapter.region_id,
      business_profile: region?.business_profile ? {
        summary_hint: region.business_profile.summary_hint,
        representative_places: region.business_profile.representative_places.slice(0, 6),
        confidence: region.business_profile.confidence,
      } : undefined,
      facts,
      supporting_places: places,
    },
    chapter_text: normalizeText(input.chapter.text),
    web_sources: sources,
    good_examples: [
      '想知道江汉关现在怎么预约参观吗？',
      '要不要讲讲这个老地名怎么来的？',
      '想顺路看看附近还能一起逛哪儿吗？',
    ],
    bad_examples: [
      '想了解更多吗？',
      '这里有什么特别之处？',
      '江汉关今天九点开门，要不要去？',
    ],
  })
}

function cleanWebSourceForPrompt(source: NarrativeWebSource) {
  return {
    title: cleanPromptText(source.title).slice(0, 48),
    snippet: cleanPromptText(source.snippet || '').slice(0, 120),
    quality: source.quality,
  }
}

function sanitizeCompanionCues(value: unknown, chapter: NarrativeChapter, maxCues: number): NarrativeCompanionCue[] {
  const items = Array.isArray(value) ? value : []
  const chapterText = normalizeText(chapter.text)
  const seen = new Set<string>()
  const cues: NarrativeCompanionCue[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const bubbleText = cleanBubbleText(raw.bubble_text)
    const prompt = cleanPromptText(String(raw.prompt || ''))
    const targetEntity = cleanPromptText(String(raw.target_entity || '')).slice(0, 24)
    let anchorText = cleanPromptText(String(raw.anchor_text || '')).slice(0, 48)
    if (!anchorText || !chapterText.includes(anchorText)) {
      if (targetEntity && chapterText.includes(targetEntity)) anchorText = targetEntity
    }
    if (!isValidBubbleText(bubbleText) || ANSWER_CLAIM_RE.test(prompt) || prompt.length < 8 || !anchorText || !chapterText.includes(anchorText)) continue
    const kind = normalizeCueKind(raw.kind)
    const priority = clampNumber(Number(raw.priority), 0.55, 0.99, 0.72)
    if (priority < 0.58) continue
    const key = `${bubbleText}|${prompt}`
    if (seen.has(key)) continue
    seen.add(key)
    cues.push({
      id: `cue-${chapter.region_id}-${stableHash(key).slice(0, 10)}`,
      region_id: chapter.region_id,
      bubble_text: bubbleText,
      prompt,
      kind,
      target_entity: targetEntity || undefined,
      anchor_text: anchorText,
      requires_web: typeof raw.requires_web === 'boolean' ? raw.requires_web : inferRequiresWeb(kind, bubbleText, prompt),
      priority,
      display_after_ms: clampNumber(Number(raw.display_after_ms), 500, 2600, 900),
    })
    if (cues.length >= maxCues) break
  }
  return cues.sort((left, right) => right.priority - left.priority)
}

function extractCueArray(rawContent: string): unknown[] {
  const value = extractJsonValue(rawContent)
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    if (Array.isArray(raw.cues)) return raw.cues
    if (Array.isArray(raw.suggestions)) return raw.suggestions
  }
  return []
}

function extractJsonValue(rawContent: string): unknown {
  const trimmed = rawContent.trim().replace(JSON_FENCE_RE, '').trim()
  const candidates = [
    trimmed,
    sliceBetween(trimmed, '{', '}'),
    sliceBetween(trimmed, '[', ']'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }
  return null
}

function sliceBetween(value: string, startToken: string, endToken: string): string {
  const start = value.indexOf(startToken)
  const end = value.lastIndexOf(endToken)
  if (start < 0 || end <= start) return ''
  return value.slice(start, end + 1)
}

function normalizeCueKind(value: unknown): NarrativeCompanionCueKind {
  const kind = String(value || '') as NarrativeCompanionCueKind
  return ALLOWED_CUE_KINDS.has(kind) ? kind : 'practical_tip'
}

function isValidBubbleText(value: string): boolean {
  if (value.length < 8 || value.length > 34) return false
  if (!/[？?]$/u.test(value)) return false
  if (GENERIC_BUBBLE_RE.test(value) || ANSWER_CLAIM_RE.test(value)) return false
  return true
}

function cleanBubbleText(value: unknown): string {
  const text = cleanPromptText(String(value || '')).replace(/[。！!]+$/gu, '？')
  return text.endsWith('?') ? `${text.slice(0, -1)}？` : text
}

function inferRequiresWeb(kind: NarrativeCompanionCueKind, bubbleText: string, prompt: string): boolean {
  return kind === 'visit_info' || kind === 'nearby_recommendation' || WEB_INTENT_RE.test(`${bubbleText}${prompt}`)
}

function normalizeText(value: string): string {
  return cleanPromptText(value).replace(/\s+/gu, ' ').trim()
}

function cleanPromptText(value: string): string {
  return String(value || '')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function stableHash(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function resolveNarrativeCompanionCuesEnabled(): boolean {
  const raw = String(process.env.NARRATIVE_COMPANION_CUES_ENABLED || process.env.NARRATIVE_LLM_NARRATION_ENABLED || 'true').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(raw)
}

function resolveCompanionCueMaxPerChapter(): number {
  const value = Number(process.env.NARRATIVE_COMPANION_CUE_MAX_PER_CHAPTER || '3')
  if (!Number.isFinite(value)) return 3
  return Math.max(0, Math.min(Math.round(value), 4))
}

function resolveCompanionCueTimeoutMs(): number {
  const value = Number(process.env.NARRATIVE_COMPANION_CUE_TIMEOUT_MS || process.env.LLM_SYNTHESIS_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || '7000')
  if (!Number.isFinite(value)) return 7000
  return Math.max(1200, Math.min(Math.round(value), 20000))
}

function resolveNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function excerpt(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, 280) : undefined
}
