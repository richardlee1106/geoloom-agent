import type { LLMProvider, LLMProviderStatus } from '../llm/types.js'
import type { NarrativeChapter, NarrationTone, SceneProfile, UserContext } from './contract.js'
import type { PathSamplerResult } from './pathSampler.js'
import type { RegionCandidate } from './regionCandidate.js'
import { isAllowedFact } from './factGrounding.js'

// 单章 LLM 生成失败的错误码。
// 上游调用方应捕获 LlmNarratorError 并把 message 写入 chapter.generation_error，
// 不要再为该章节回退到模板文本。
export type LlmNarratorErrorCode =
  | 'disabled'
  | 'no_provider'
  | 'provider_not_ready'
  | 'request_failed'
  | 'invalid_json'
  | 'missing_text'
  | 'wrong_region_id'
  | 'forbidden_word'
  | 'url_leak'
  | 'template_listicle'
  | 'too_short'

export class LlmNarratorError extends Error {
  constructor(
    public readonly code: LlmNarratorErrorCode,
    message: string,
    public readonly raw_content_excerpt?: string,
  ) {
    super(message)
    this.name = 'LlmNarratorError'
  }
}

export interface LlmNarratorDebug {
  used: boolean
  provider?: LLMProviderStatus
  latency_ms?: number
  error?: string
  error_code?: LlmNarratorErrorCode
  raw_content_excerpt?: string
  // 兼容字段：上游消费者（前端调试面板/历史断言）会用 fallback_reason 区分
  // 'invalid_llm_output'（LLM 返回不通过合同校验）与 'llm_error'（请求/超时/底层异常）。
  // 在新架构下章节文本不再 fallback 到模板，但保留这个分类便于诊断。
  fallback_reason?:
    | 'invalid_llm_output'
    | 'partial_invalid_llm_output'
    | 'llm_error'
    | 'disabled'
    | 'no_provider'
    | 'provider_not_ready'
    | 'missing_llm_provider'
  validation_errors?: string[]
  partial_fallback_count?: number
}

export interface ChapterNarrationResult {
  chapter: NarrativeChapter
  debug: LlmNarratorDebug
}

export interface GraphNarrationResult {
  chapters: NarrativeChapter[]
  debug: LlmNarratorDebug
}

// lite 是唯一 prompt 形态，保留类型别名便于后续扩展
export type LlmNarratorPromptVariant = 'lite'
export type LlmNarratorPromptVariantInput = LlmNarratorPromptVariant | 'auto'

export function resolveLlmNarratorPromptVariant(_value?: unknown): LlmNarratorPromptVariant {
  return 'lite'
}

// 仅用于硬性合同校验：泄漏内部工程字段或论文腔词都视为不可接受的 LLM 输出。
// 这些词出现时一律 throw，让上游显示真实错误而不是模板兜底。
const FORBIDDEN_WORDS = [
  '宿舍', '家属区', '楼栋', '服务中心', '广告', '优惠', '促销', '热线', '联系电话', '招商', '加盟',
  '空间上下文', '功能拼图', '活动底盘', '转场逻辑', '代表性节点', '观察尺度',
  '任务设定', '当前章节', '上边这份历史', 'style_contract', 'narration_control', 'target_region_id',
]
const FORBIDDEN_WORD_RE = new RegExp(FORBIDDEN_WORDS.join('|'), 'iu')
const FORBIDDEN_ENG_RE = /(?<![a-zA-Z])(?:score|tier|graph|URL|LOD|strategy|route_strategy)(?![a-zA-Z])/iu
const URL_RE = /https?:\/\/\S+/iu
const LISTICLE_RE = /(?:^|[。！？\n\r])\s*(?:\d+[.．、]|[一二三四五六七八九十][、.．]|[-*]\s+|[（(][一二三四五六七八九十\d]+[）)])/u
const GUIDE_LISTICLE_PHRASE_RE = /(最舒服的用法|想活动活动|想歇歇脚|想吃点喝点|第一[，,、]|第二[，,、]|第三[，,、]|一是|二是|三是)/u
const MARKDOWN_RE = /\*\*|__|#{1,6}\s|\[[^\]]+\]\([^)]+\)/u

// 单章 LLM 解说生成。成功返回 chapter（带 text），失败 throw LlmNarratorError。
// 调用方需要负责并发调度（不同 region_id 应当并行调用），以及把错误映射到 chapter.generation_error。
export async function buildGraphNarrationChapter(input: {
  chapter: NarrativeChapter
  allChapters: NarrativeChapter[]
  regions: RegionCandidate[]
  path: PathSamplerResult
  scene: SceneProfile
  tone: NarrationTone
  userContext: UserContext
  llmProvider?: LLMProvider
  enabled?: boolean
}): Promise<ChapterNarrationResult> {
  const enabled = input.enabled ?? true
  if (!enabled) {
    throw new LlmNarratorError('disabled', 'LLM 解说已禁用 (NARRATIVE_LLM_NARRATION_ENABLED=false)')
  }
  const provider = input.llmProvider
  if (!provider) {
    throw new LlmNarratorError('no_provider', '未注入 LLM provider')
  }
  const providerStatus = provider.getStatus()
  if (!provider.isReady()) {
    throw new LlmNarratorError('provider_not_ready', `LLM provider 未就绪：${providerStatus.provider || 'unknown'}`)
  }

  const started = Date.now()
  let rawContent = ''
  try {
    const response = await provider.complete({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      tools: [],
      timeoutMs: Number(process.env.NARRATIVE_LLM_NARRATION_TIMEOUT_MS || process.env.LLM_SYNTHESIS_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || '18000'),
      temperature: resolveNumber(process.env.NARRATIVE_LLM_TEMPERATURE, 0.85),
      topP: resolveNumber(process.env.NARRATIVE_LLM_TOP_P, 0.95),
    })
    rawContent = response.assistantMessage.content || ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new LlmNarratorError('request_failed', `LLM 请求失败：${message}`)
  }

  const targetRegionId = input.chapter.region_id
  const extracted = extractChapterText(rawContent, targetRegionId)
  const text = extracted.text
  if (!text) {
    throw new LlmNarratorError('missing_text', 'LLM 返回未包含可用 text 字段', excerpt(rawContent))
  }

  validateChapterText(text, rawContent)
  if (extracted.wrongRegionId) {
    throw new LlmNarratorError('wrong_region_id', `LLM 返回 region_id=${extracted.regionId}，不匹配目标章节 ${targetRegionId}`, excerpt(rawContent))
  }

  return {
    chapter: { ...input.chapter, text, story_tags: input.chapter.story_tags },
    debug: {
      used: true,
      provider: providerStatus,
      latency_ms: Date.now() - started,
    },
  }
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
  targetRegionId?: string
}): Promise<GraphNarrationResult> {
  const targetChapters = input.targetRegionId
    ? input.chapters.filter((chapter) => chapter.region_id === input.targetRegionId)
    : input.chapters
  if (targetChapters.length === 0) {
    return { chapters: [], debug: { used: false, provider: input.llmProvider?.getStatus(), fallback_reason: 'invalid_llm_output', error: '未找到目标章节' } }
  }
  const settled = await Promise.allSettled(targetChapters.map((chapter) => buildGraphNarrationChapter({
    chapter,
    allChapters: input.chapters,
    regions: input.regions,
    path: input.path,
    scene: input.scene,
    tone: input.tone,
    userContext: input.userContext,
    llmProvider: input.llmProvider,
    enabled: input.enabled,
  })))
  const validationErrors: string[] = []
  let usedCount = 0
  let lastSuccessDebug: LlmNarratorDebug | undefined
  const chapters = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      usedCount += 1
      lastSuccessDebug = result.value.debug
      return result.value.chapter
    }
    const reason = result.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    validationErrors.push(message)
    return targetChapters[index]
  })
  if (usedCount === targetChapters.length) {
    return { chapters, debug: lastSuccessDebug || { used: true, provider: input.llmProvider?.getStatus() } }
  }
  if (usedCount > 0) {
    return {
      chapters,
      debug: {
        ...(lastSuccessDebug || { used: true, provider: input.llmProvider?.getStatus() }),
        used: true,
        fallback_reason: 'partial_invalid_llm_output',
        partial_fallback_count: targetChapters.length - usedCount,
        validation_errors: validationErrors,
        error: validationErrors.join(' | '),
      },
    }
  }
  return {
    chapters: targetChapters,
    debug: {
      used: false,
      provider: input.llmProvider?.getStatus(),
      fallback_reason: input.enabled === false ? 'disabled' : input.llmProvider ? 'invalid_llm_output' : 'missing_llm_provider',
      validation_errors: validationErrors,
      error: validationErrors.join(' | '),
    },
  }
}

function validateChapterText(text: string, rawContent: string): void {
  if (text.length < 20) {
    throw new LlmNarratorError('too_short', `LLM 输出过短 (${text.length} 字)，信息不足`, excerpt(rawContent))
  }
  const forbidden = text.match(FORBIDDEN_WORD_RE)?.[0]
  if (forbidden) {
    throw new LlmNarratorError('forbidden_word', `LLM 输出命中禁词「${forbidden}」`, excerpt(rawContent))
  }
  const engForbidden = text.match(FORBIDDEN_ENG_RE)?.[0]
  if (engForbidden) {
    throw new LlmNarratorError('forbidden_word', `LLM 输出泄漏内部工程词「${engForbidden}」`, excerpt(rawContent))
  }
  if (URL_RE.test(text)) {
    throw new LlmNarratorError('url_leak', 'LLM 输出包含 URL', excerpt(rawContent))
  }
  if (LISTICLE_RE.test(text) || GUIDE_LISTICLE_PHRASE_RE.test(text) || MARKDOWN_RE.test(text)) {
    throw new LlmNarratorError('template_listicle', 'LLM 输出像清单或 Markdown 攻略，不适合口语导览', excerpt(rawContent))
  }
}

function extractChapterText(rawContent: string, targetRegionId: string): { text: string; wrongRegionId?: boolean; regionId?: string } {
  const trimmed = rawContent.trim()
  if (!trimmed) return { text: '' }
  const parsed = parseLooseJson(trimmed)
  if (parsed) {
    const fromObject = pickTextForTarget(parsed, targetRegionId)
    if (fromObject.text) return fromObject
  }
  // 允许 LLM 直接输出纯文本（不强制 JSON）。
  if (!/[{[]/u.test(trimmed)) return { text: cleanupRawText(trimmed) }
  return { text: '' }
}

function pickTextForTarget(value: unknown, targetRegionId: string): { text: string; wrongRegionId?: boolean; regionId?: string } {
  if (typeof value === 'string') return { text: cleanupRawText(value) }
  if (Array.isArray(value)) {
    let firstText: { text: string; wrongRegionId?: boolean; regionId?: string } = { text: '' }
    for (const item of value) {
      const picked = pickTextForTarget(item, targetRegionId)
      if (!firstText.text && picked.text) firstText = picked
      if (picked.text && !picked.wrongRegionId) return picked
    }
    return firstText
  }
  if (!isRecord(value)) return { text: '' }
  const record = value
  const regionId = readString(record.region_id) || readString(record.regionId) || readString(record.id) || readString(record.region)
  const text = readString(record.text) || readString(record.content) || readString(record.narration_text) || readString(record.voice_text)
  if (text) {
    const cleaned = cleanupRawText(text)
    return { text: cleaned, wrongRegionId: Boolean(regionId && regionId !== targetRegionId), regionId }
  }
  // 嵌套结构尝试递归
  const nestedKeys = ['chapter', 'chapters', 'data', 'narration']
  for (const key of nestedKeys) {
    if (key in record) {
      const inner = pickTextForTarget(record[key], targetRegionId)
      if (inner.text) return inner
    }
  }
  return { text: '' }
}

function cleanupRawText(text: string): string {
  return text
    .replace(/```(?:json)?|```/giu, '')
    .replace(/^\s*[，、；：,.:\s]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function parseLooseJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1]?.trim()
  const candidate = fenced || text
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    // try object
    const objStart = candidate.indexOf('{')
    const objEnd = candidate.lastIndexOf('}')
    if (objStart >= 0 && objEnd > objStart) {
      try { return JSON.parse(candidate.slice(objStart, objEnd + 1)) as unknown } catch { /* ignore */ }
    }
    const arrStart = candidate.indexOf('[')
    const arrEnd = candidate.lastIndexOf(']')
    if (arrStart >= 0 && arrEnd > arrStart) {
      try { return JSON.parse(candidate.slice(arrStart, arrEnd + 1)) as unknown } catch { /* ignore */ }
    }
    return null
  }
}

function buildSystemPrompt(): string {
  // 极简风格指令：把组织权交给 LLM，不再硬塞四段式骨架或策略名清单。
  // 只保留必要的事实诚信和合同约束。
  const lines = [
    '你是一个土生土长的武汉本地朋友，正带外地朋友顺着地图走街串巷，一段一段聊这片区域。',
    '说话像本地人边走边聊：短句、具体、自然，有生活气，可以带一点武汉日常口吻（比如过早、江边吹风、钻巷子），但不要硬塞方言或卖弄。',
    '你会拿到当前片区的真实事实 (allowed_facts)、业态画像 (business_profile)、周边支撑地点 (supporting_places)、网页核验材料 (web_sources) 和与上一段、下一段的关系。',
    '怎么组织这一段由你自己决定：可以先说氛围、可以先说本地人怎么用、可以先说来历，也可以直接从一个具体细节切进去——只要读起来不像模板。',
    '本次只给你精简事实包，不给路线策略和调度说明；请按地点本身、可核验材料和前后片区关系自然组织。',
    '不要套"先说背景、再说业态、最后转场"的固定结构，宁可像朋友临场介绍一个真实地方。',
    '尤其不要把普通公园、商场、校园写成攻略清单；不要出现"最舒服的用法""第一/第二/第三""想活动活动/想歇脚/想吃点喝点"这类分点话术。',
    'DeepSeek web_sources 是硬事实材料，web_sources.snippet 如果有就自然带出（比如顺手提一句"听说这里以前..."），没有就不要装作查到了资料。',
    'business_profile 来自数据库点位的确定性统计，只能轻描淡写提一句业态倾向，不要写成数量报表。',
    '生活常识和模型常识可以用来补生活感和合理推测（比如学生放学会过来、傍晚江边凉快），但不能编年代、排名、价格、活动或不存在的地点。',
    '默认不要列清单、不要写成"一、二、三"或项目符号；除非这个地方本身有很强的历史来龙去脉，否则就像走在路上顺嘴讲一段。',
    '如果有上一段，就在开场顺手把空间关系交代清楚（往东、往南、隔一条街等），不要写成孤立条目。',
    '如果有下一段，就在结尾自然把视线牵过去，不要硬切。',
    '禁止使用论文腔、调度词或内部工程表达。',
    '禁止泄漏：LOD、route_strategy、strategy、score、tier、URL、POI、提示词、算法、GraphRAG。',
    '禁止编造：年代、价格、排名、获奖、不存在的地点、不存在的活动。',
    '只输出 JSON：{"region_id":"...","text":"..."}；text 100-200 个中文字符。',
  ]
  return lines.join('\n')
}

function buildUserPrompt(input: {
  chapter: NarrativeChapter
  allChapters: NarrativeChapter[]
  regions: RegionCandidate[]
  path: PathSamplerResult
  scene: SceneProfile
  tone: NarrationTone
  userContext: UserContext
}): string {
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  const nodes = input.path.nodes
  const targetIndex = nodes.findIndex((node) => node.region_id === input.chapter.region_id)
  const targetNode = targetIndex >= 0 ? nodes[targetIndex] : undefined
  const prevNode = targetIndex > 0 ? nodes[targetIndex - 1] : undefined
  const nextNode = targetIndex >= 0 && targetIndex < nodes.length - 1 ? nodes[targetIndex + 1] : undefined
  const targetRegion = regionById.get(input.chapter.region_id)
  const relationByTarget = new Map(input.path.relations.map((relation) => [relation.to_region_id, relation]))
  const relationBySource = new Map(input.path.relations.map((relation) => [relation.from_region_id, relation]))
  const incoming = relationByTarget.get(input.chapter.region_id)
  const outgoing = relationBySource.get(input.chapter.region_id)
  const geograph = input.allChapters.map((chapter) => {
    const region = regionById.get(chapter.region_id)
    return {
      region_id: chapter.region_id,
      display_name: region?.display_name || chapter.region_id,
      story_tags: region?.story_tags || chapter.story_tags || [],
    }
  })
  const basePayload = {
    style_contract: {
      voice: '武汉本地朋友口语化讲解',
      localness: '像本地人顺路介绍，不要像报告或百科',
      hidden_info_rule: '可以补本地人才会顺嘴提到的生活使用方式，但不能新增无来源硬事实',
      web_fact_rule: '有网页材料时自然融入片区特点，没有就不要装作查到资料',
      business_profile_rule: '有业态画像时只用一句生活化表达，不要罗列计数',
      model_knowledge_rule: '生活常识可以补氛围，不能新增无来源年代、价格、排名或活动',
    },
    geograph,
    output_contract: { region_id_order: [input.chapter.region_id] },
    target_region_id: input.chapter.region_id,
    chapter_index: Math.max(0, targetIndex),
    is_first_chapter: targetIndex === 0,
    is_last_chapter: targetIndex >= 0 && targetIndex === nodes.length - 1,
    scene: input.scene,
    tone: input.tone,
    user_context: input.userContext,
    target_region: targetRegion ? describeRegionForLlm(targetRegion) : { region_id: input.chapter.region_id, display_name: input.chapter.region_id },
    previous_region: prevNode ? describeAdjacentRegion(prevNode.region_id, regionById, prevNode.transition_reason) : null,
    next_region: nextNode ? describeAdjacentRegion(nextNode.region_id, regionById, nextNode.transition_reason) : null,
    relation_from_previous: incoming ? {
      from_region_id: incoming.from_region_id,
      type: incoming.type,
      shared_story_tags: incoming.shared_story_tags || [],
      evidence: incoming.evidence || [],
    } : null,
    relation_to_next: outgoing ? {
      to_region_id: outgoing.to_region_id,
      type: outgoing.type,
      shared_story_tags: outgoing.shared_story_tags || [],
      evidence: outgoing.evidence || [],
    } : null,
    transition_reason: targetNode?.transition_reason || '',
    allowed_facts: (targetRegion?.narrative_facts || []).filter(isAllowedFact).slice(0, 5).map((fact) => fact.claim),
    business_profile: targetRegion?.business_profile ? {
      summary_hint: targetRegion.business_profile.summary_hint,
      confidence: targetRegion.business_profile.confidence,
      sample_size: targetRegion.business_profile.sample_size,
      dominant_main_types: targetRegion.business_profile.dominant_main_types.slice(0, 3).map(({ name, count, share }) => ({ name, count, share })),
      dominant_sub_types: targetRegion.business_profile.dominant_sub_types.slice(0, 4).map(({ name, count, share }) => ({ name, count, share })),
      representative_places: targetRegion.business_profile.representative_places.slice(0, 5),
    } : null,
    supporting_places: (targetRegion?.pois || [])
      .filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium')
      .slice(0, 8)
      .map((poi) => ({ name: poi.display_name, category: poi.category_main || '' })),
    web_sources: (input.chapter.web_sources || []).slice(0, 3).map((source) => ({
      title: source.title,
      snippet: cleanWebSourceSnippetForLlm(source.snippet),
      quality: source.quality || 'general',
    })),
  }
  return JSON.stringify(basePayload)
}

function describeRegionForLlm(region: RegionCandidate) {
  return {
    region_id: region.id,
    display_name: region.display_name,
    role: region.role,
    story_tags: region.story_tags || [],
    business_profile: region.business_profile ? {
      summary_hint: region.business_profile.summary_hint,
      confidence: region.business_profile.confidence,
    } : null,
  }
}

function cleanWebSourceSnippetForLlm(value: unknown): string {
  return String(value || '')
    .replace(/\[\d+\]\((?:https?:\/\/|www\.)[^)]+\)/giu, '')
    .replace(/\[([^\]]{1,40})\]\((?:https?:\/\/|www\.)[^)]+\)/giu, '$1')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/www\.\S+/giu, '')
    .replace(/(?:\[\d+\]|【\d+】|（\d+）|\(\d+\))/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/[，,、；;：:]*….*$/u, '')
    .replace(/^[\s"'“”‘’：:，,。；;]+|[\s"'“”‘’]+$/gu, '')
    .trim()
}

function describeAdjacentRegion(regionId: string, regionById: Map<string, RegionCandidate>, transitionReason: string) {
  const region = regionById.get(regionId)
  return {
    region_id: regionId,
    display_name: region?.display_name || regionId,
    story_tags: region?.story_tags || [],
    transition_reason: transitionReason || '',
  }
}

function excerpt(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 220)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
