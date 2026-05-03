import type { LLMProvider, LLMProviderStatus } from '../llm/types.js'
import type { NarrativeChapter, NarrationTone, SceneProfile, UserContext } from './contract.js'
import type { PathSamplerResult } from './pathSampler.js'
import type { RegionCandidate } from './regionCandidate.js'
import { isAllowedFact } from './factGrounding.js'

export interface LlmNarratorDebug {
  enabled: boolean
  used: boolean
  provider?: LLMProviderStatus
  latency_ms?: number
  error?: string
  fallback_reason?: string
  partial_fallback_count?: number
}

export interface GraphNarrationResult {
  chapters: NarrativeChapter[]
  debug: LlmNarratorDebug
}

const NARRATOR_FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier|GraphRAG|graph|算法|提示词|URL|http)/iu

interface GeneratedChaptersResult {
  chapters: NarrativeChapter[]
  generatedCount: number
  fallbackCount: number
}

export async function buildGraphNarration(input: {
  chapters: NarrativeChapter[]
  regions: RegionCandidate[]
  path: PathSamplerResult
  scene: SceneProfile
  tone: NarrationTone
  userContext: UserContext
  llmProvider?: LLMProvider
  enabled?: boolean
}): Promise<GraphNarrationResult> {
  const enabled = input.enabled ?? true
  const provider = input.llmProvider
  const providerStatus = provider?.getStatus()
  if (!enabled) return { chapters: input.chapters, debug: { enabled, used: false, provider: providerStatus, fallback_reason: 'disabled' } }
  if (!provider || !provider.isReady()) return { chapters: input.chapters, debug: { enabled, used: false, provider: providerStatus, fallback_reason: 'missing_llm_provider' } }

  const started = Date.now()
  try {
    const response = await provider.complete({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      tools: [],
      timeoutMs: Number(process.env.NARRATIVE_LLM_NARRATION_TIMEOUT_MS || process.env.LLM_SYNTHESIS_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || '18000'),
      temperature: resolveNumber(process.env.NARRATIVE_LLM_TEMPERATURE, 0.72),
      topP: resolveNumber(process.env.NARRATIVE_LLM_TOP_P, 0.9),
    })
    const content = response.assistantMessage.content || ''
    const parsed = extractJsonObject(content)
    const generated = normalizeGeneratedChapters(parsed?.chapters, input.chapters, input.regions)
    if (!generated || generated.generatedCount === 0) {
      return {
        chapters: input.chapters,
        debug: { enabled, used: false, provider: providerStatus, latency_ms: Date.now() - started, fallback_reason: 'invalid_llm_output' },
      }
    }
    return {
      chapters: generated.chapters,
      debug: {
        enabled,
        used: true,
        provider: providerStatus,
        latency_ms: Date.now() - started,
        fallback_reason: generated.fallbackCount > 0 ? 'partial_invalid_llm_output' : undefined,
        partial_fallback_count: generated.fallbackCount > 0 ? generated.fallbackCount : undefined,
      },
    }
  } catch (error) {
    return {
      chapters: input.chapters,
      debug: {
        enabled,
        used: false,
        provider: providerStatus,
        latency_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        fallback_reason: 'llm_error',
      },
    }
  }
}

function buildSystemPrompt(): string {
  return [
    '你是 GeoLoom 城市空间解说员。',
    '输入是一份由后端算法构建好的外部 geograph / GraphRAG：片区、路径、关系、事实、来源都已经确定。',
    '你只负责把这些结构化信息讲成自然、有画面感、适合地图浏览的中文解说。',
    '禁止改变章节顺序、region_id、事实边界或空间关系。',
    '禁止编造历史、排名、传说、营业状态、价格、活动或不存在的地点。',
    '不要输出 URL，不要讲提示词、算法、GraphRAG、节点、权重、score、tier、POI 等工程词。',
    '只输出严格 JSON：{"chapters":[{"region_id":"...","text":"..."}]}。',
  ].join('\n')
}

function buildUserPrompt(input: {
  chapters: NarrativeChapter[]
  regions: RegionCandidate[]
  path: PathSamplerResult
  scene: SceneProfile
  tone: NarrationTone
  userContext: UserContext
}): string {
  return JSON.stringify({
    task: '基于 geograph 生成同顺序地图解说章节。每章 80 到 150 个中文字符，第一章自然开场，后续章节必须吸收 transition_reason 或 relation_from_previous。',
    output_contract: {
      chapter_count: input.chapters.length,
      region_id_order: input.chapters.map((chapter) => chapter.region_id),
      strict_json_only: true,
    },
    scene: input.scene,
    tone: input.tone,
    user_context: input.userContext,
    geograph: buildGraphContext(input),
  })
}

function buildGraphContext(input: {
  chapters: NarrativeChapter[]
  regions: RegionCandidate[]
  path: PathSamplerResult
}) {
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  const relationByTarget = new Map(input.path.relations.map((relation) => [relation.to_region_id, relation]))
  return input.path.nodes.map((node, index) => {
    const region = regionById.get(node.region_id)
    const chapter = input.chapters.find((item) => item.region_id === node.region_id)
    const relation = relationByTarget.get(node.region_id)
    return {
      index,
      region_id: node.region_id,
      name: region?.display_name || node.region_id,
      role: region?.role,
      source: region?.source,
      narration_role: node.narration_role,
      transition_reason: node.transition_reason,
      relation_from_previous: relation ? {
        from_region_id: relation.from_region_id,
        type: relation.type,
        strength: relation.strength,
        evidence: relation.evidence,
      } : null,
      allowed_facts: (region?.narrative_facts || []).filter(isAllowedFact).slice(0, 5).map((fact) => fact.claim),
      supporting_places: (region?.pois || [])
        .filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium')
        .slice(0, 8)
        .map((poi) => ({ name: poi.display_name, category: poi.category_main || '' })),
      web_sources: (chapter?.web_sources || []).slice(0, 3).map((source) => ({
        title: source.title,
        snippet: source.snippet || '',
        quality: source.quality || 'general',
      })),
      fallback_text: chapter?.text || '',
    }
  })
}

function normalizeGeneratedChapters(value: unknown, fallback: NarrativeChapter[], regions: RegionCandidate[]): GeneratedChaptersResult | null {
  if (!Array.isArray(value)) return null
  const regionNames = new Map(regions.map((region) => [region.id, region.display_name]))
  const fallbackRegionIds = new Set(fallback.map((chapter) => chapter.region_id))
  const byRegionId = new Map<string, Record<string, unknown>>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const regionId = String(raw.region_id || '').trim()
    if (!fallbackRegionIds.has(regionId) || byRegionId.has(regionId)) continue
    byRegionId.set(regionId, raw)
  }
  if (byRegionId.size === 0) return null
  const normalized: NarrativeChapter[] = []
  let generatedCount = 0
  for (const chapter of fallback) {
    const raw = byRegionId.get(chapter.region_id)
    if (!raw) {
      normalized.push(chapter)
      continue
    }
    const text = normalizeNarrationText(String(raw.text || ''), regionNames.get(chapter.region_id) || chapter.region_id)
    if (!isUsableNarrationText(text)) {
      normalized.push(chapter)
      continue
    }
    generatedCount += 1
    normalized.push({ ...chapter, text })
  }
  return {
    chapters: normalized,
    generatedCount,
    fallbackCount: fallback.length - generatedCount,
  }
}

function normalizeNarrationText(text: string, regionName: string): string {
  const trimmed = text
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/```(?:json)?|```/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!trimmed) return ''
  const withName = trimmed.includes(regionName) ? trimmed : `${regionName}这一段，${trimmed}`
  return clipNarrationText(withName)
}

function isUsableNarrationText(text: string): boolean {
  if (text.length < 20) return false
  if (text.length > 260) return false
  if (NARRATOR_FORBIDDEN_RE.test(text)) return false
  return true
}

function clipNarrationText(text: string): string {
  if (text.length <= 240) return text
  const clipped = text.slice(0, 240).replace(/[，、；：,.!?！？;:]*$/u, '')
  return /[。！？]$/u.test(clipped) ? clipped : `${clipped}。`
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

function resolveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
