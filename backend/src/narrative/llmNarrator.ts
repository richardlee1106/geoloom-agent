import type { LLMProvider, LLMProviderStatus } from '../llm/types.js'
import type { LODLevel, NarrativeChapter, NarrativeRouteStrategy, NarrationTone, SceneProfile, UserContext } from './contract.js'
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

const NARRATOR_FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier|GraphRAG|graph|算法|提示词|URL|http|LOD|route_strategy|strategy|策略矩阵|路线策略)/iu

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
    '可以使用 LOD、route_strategy、chapter_control 作为写法控制，但不要在正文中直呼这些内部字段或策略名。',
    '禁止改变章节顺序、region_id、事实边界或空间关系。',
    '禁止编造历史、排名、传说、营业状态、价格、活动或不存在的地点。',
    '不要说“位于当前视野范围内”“在当前视野中”这类废话；后续章节必须优先讲与上一片区的东西南北相对关系。',
    '路线按地图阅读习惯从左到右、由上到下推进，章节之间要互相牵引，不要写成孤立地点百科。',
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
    task: '基于 geograph 和 narration_control 生成同顺序地图解说章节。每章 80 到 150 个中文字符，第一章自然开场，后续章节必须吸收 transition_reason、relation_from_previous 与 chapter_control。',
    output_contract: {
      chapter_count: input.chapters.length,
      region_id_order: input.chapters.map((chapter) => chapter.region_id),
      strict_json_only: true,
    },
    scene: input.scene,
    tone: input.tone,
    user_context: input.userContext,
    narration_control: buildNarrationControl(input.path),
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
      chapter_control: buildChapterControl(input.path, index),
      transition_reason: node.transition_reason,
      story_tags: node.story_tags || region?.story_tags || [],
      relation_from_previous: relation ? {
        from_region_id: relation.from_region_id,
        type: relation.type,
        strength: relation.strength,
        evidence: relation.evidence,
        shared_story_tags: relation.shared_story_tags,
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

function buildNarrationControl(path: PathSamplerResult) {
  return {
    lod: path.lodPolicy.lod,
    route_strategy: path.strategy,
    route_strategy_label: routeStrategyLabel(path.strategy),
    lod_instruction: lodInstruction(path.lodPolicy.lod),
    strategy_instruction: routeStrategyInstruction(path.strategy),
    pacing_instruction: pacingInstruction(path.lodPolicy.lod),
    path_story_tags: path.storyTags,
    relation_types: path.relations.map((relation) => relation.type),
    chapter_rules: [
      '不要平均复述所有支撑地点，每章只抓最能服务当前尺度和路线主题的一到两个空间线索。',
      '章节之间要体现路径推进，不要把每章写成互不相干的地点介绍。',
      '不要使用“位于当前视野范围内”“在当前视野中”作为空间说明，要改写为与上一章或相邻片区的东西南北关系。',
      '可以把 fallback_text 当作保底事实，但应按 LOD 和 route strategy 重写语气与观察尺度。',
    ],
  }
}

function buildChapterControl(path: PathSamplerResult, index: number) {
  return {
    lod_focus: chapterLodFocus(path.lodPolicy.lod, index),
    route_focus: index === 0 ? routeOpeningFocus(path.strategy) : routeTransitionFocus(path.strategy),
    transition_duty: index === 0
      ? '作为开场，建立当前路线的观察尺度和主题，不要急着铺开所有片区。'
      : '作为后续章节，必须把上一章和本章之间的空间关系讲成自然转场。',
  }
}

function lodInstruction(lod: LODLevel): string {
  if (lod === 'micro') return '按近景讲法处理，强调主体片区、贴身支撑点和可感知的局部空间关系，少做城市级概括。'
  if (lod === 'macro') return '按大范围讲法处理，强调多个功能板块如何拼成城市横截面，不要写成逐点打卡清单。'
  return '按片区讲法处理，强调主体、支撑空间与相邻功能之间的互补和过渡。'
}

function pacingInstruction(lod: LODLevel): string {
  if (lod === 'micro') return '节奏慢一些，允许解释细节和贴近镜头的空间证据。'
  if (lod === 'macro') return '节奏更概括，用较少句子完成跨片区连接。'
  return '节奏适中，既保留空间证据，也讲清片区之间的功能联系。'
}

function chapterLodFocus(lod: LODLevel, index: number): string {
  if (lod === 'micro') return index === 0 ? '先把镜头落到主体片区本身。' : '继续解释近距离支撑关系。'
  if (lod === 'macro') return index === 0 ? '先建立大范围观察框架。' : '把本章放进城市功能拼图。'
  return index === 0 ? '先建立片区尺度的主题。' : '讲清相邻功能之间的过渡。'
}

function routeOpeningFocus(strategy: NarrativeRouteStrategy): string {
  switch (strategy) {
    case 'macro_city_cross_section': return '开场要像城市横截面导览，先给出大范围功能拼图。'
    case 'campus_ecology_walk': return '开场要建立校园文化与生态开放空间之间的主线。'
    case 'campus_life_loop': return '开场要建立校园与日常生活配套的环线感。'
    case 'commercial_food_walk': return '开场要建立商业人流和餐饮烟火气的体验主线。'
    case 'night_market_walk': return '开场要建立街市、夜间消费和本地生活气。'
    case 'heritage_culture_walk': return '开场要建立历史文化线索和慢游节奏。'
    case 'heritage_commerce_walk': return '开场要建立历史街区与当代消费活力并置的主线。'
    case 'waterfront_ecology_walk': return '开场要建立水岸、绿地和生态舒展感。'
    case 'waterfront_leisure_walk': return '开场要建立滨水休闲和慢行游览节奏。'
    case 'commercial_axis_walk': return '开场要建立商业轴线和步行动线。'
    case 'civic_service_walk': return '开场要建立公共服务如何支撑周边日常活动。'
    case 'transit_gateway_walk': return '开场要建立从交通入口进入腹地的方向感。'
    case 'micro_detail_walk': return '开场要把镜头压近，先讲清主体和近邻支撑。'
    case 'meso_mixed_cluster_walk': return '开场要建立混合片区的功能组合。'
    case 'mixed_discovery_walk': return '开场要建立探索式观察线索。'
    case 'seeded_spatial_story': return '开场要按空间邻近关系自然起笔。'
  }
}

function routeTransitionFocus(strategy: NarrativeRouteStrategy): string {
  switch (strategy) {
    case 'macro_city_cross_section': return '转场要说明本章补上了哪一类城市功能。'
    case 'campus_ecology_walk': return '转场要说明校园文化如何接到绿地、水岸或生态空间。'
    case 'campus_life_loop': return '转场要说明校园活动如何接到周边生活配套。'
    case 'commercial_food_walk': return '转场要说明商业消费和餐饮活动如何相互放大。'
    case 'night_market_walk': return '转场要说明街市生活气如何延续。'
    case 'heritage_culture_walk': return '转场要说明历史文化线索如何递进。'
    case 'heritage_commerce_walk': return '转场要说明历史记忆和当代商业活力如何并置。'
    case 'waterfront_ecology_walk': return '转场要说明开放生态空间如何延展。'
    case 'waterfront_leisure_walk': return '转场要说明水岸、绿地和休闲活动如何连成轴线。'
    case 'commercial_axis_walk': return '转场要说明商业轴线如何继续推进。'
    case 'civic_service_walk': return '转场要说明公共服务和周边日常活动如何互相支撑。'
    case 'transit_gateway_walk': return '转场要说明从入口、站点或通道进入下一个活动腹地。'
    case 'micro_detail_walk': return '转场要说明贴身空间关系，不要跳到宏大概括。'
    case 'meso_mixed_cluster_walk': return '转场要说明片区内不同功能如何互补。'
    case 'mixed_discovery_walk': return '转场要保留探索感，同时解释空间邻近关系。'
    case 'seeded_spatial_story': return '转场要按相邻空间自然推进。'
  }
}

function routeStrategyInstruction(strategy: NarrativeRouteStrategy): string {
  return `${routeStrategyLabel(strategy)}：${routeTransitionFocus(strategy)}`
}

function routeStrategyLabel(strategy: NarrativeRouteStrategy): string {
  const labels: Record<NarrativeRouteStrategy, string> = {
    seeded_spatial_story: '空间邻近叙事',
    micro_detail_walk: '近景细节导览',
    meso_mixed_cluster_walk: '片区混合功能导览',
    macro_city_cross_section: '城市横截面导览',
    campus_ecology_walk: '校园生态导览',
    campus_life_loop: '校园生活环线',
    commercial_food_walk: '商业餐饮导览',
    night_market_walk: '夜市街巷导览',
    heritage_culture_walk: '历史文化导览',
    heritage_commerce_walk: '历史商业并置导览',
    waterfront_ecology_walk: '滨水生态导览',
    waterfront_leisure_walk: '滨水休闲导览',
    commercial_axis_walk: '商业轴线导览',
    civic_service_walk: '公共服务导览',
    transit_gateway_walk: '交通入口导览',
    mixed_discovery_walk: '混合探索导览',
  }
  return labels[strategy]
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
    normalized.push({ ...chapter, text, story_tags: chapter.story_tags })
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
