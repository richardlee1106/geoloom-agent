import type { LLMProvider } from '../llm/types.js'
import type {
  NarrativeAssistantProvider,
  NarrativeAssistantRequest,
  NarrativeAssistantResponse,
  NarrativeAssistantUiAction,
  NarrativeChapter,
  NarrativeRegion,
  NarrativeResponse,
} from './contract.js'

interface NarrativeAssistantServiceOptions {
  llmProvider?: LLMProvider
  timeoutMs?: number
}

type AssistantContext = {
  state: NarrativeResponse | null
  activeIndex: number
  activeRegion: NarrativeRegion | null
  activeChapter: NarrativeChapter | null
  pathRegions: NarrativeRegion[]
}

const CONTROL_REPLAN_THEME: Array<{ theme: string; label: string; pattern: RegExp }> = [
  { theme: 'commerce', label: '商业活力', pattern: /商业|商圈|消费|购物|餐饮|吃|美食/u },
  { theme: 'nightlife', label: '夜生活', pattern: /夜生活|夜市|晚上|宵夜|酒吧/u },
  { theme: 'memory', label: '城市记忆', pattern: /历史|记忆|老街|文化|人文|故事/u },
  { theme: 'family', label: '亲子休闲', pattern: /亲子|家庭|孩子|儿童|公园|休闲/u },
  { theme: 'education', label: '教育文化', pattern: /教育|大学|学校|校园|科教/u },
  { theme: 'commute', label: '通勤出行', pattern: /通勤|出行|地铁|公交|换乘|交通/u },
  { theme: 'tourism', label: '游览打卡', pattern: /旅游|游览|景点|打卡|逛|怎么玩/u },
]

const MAX_TEXT = 900

export class NarrativeAssistantService implements NarrativeAssistantProvider {
  constructor(private readonly options: NarrativeAssistantServiceOptions = {}) {}

  async answer(input: NarrativeAssistantRequest): Promise<NarrativeAssistantResponse> {
    const message = normalizeText(input.message).slice(0, MAX_TEXT)
    const context = buildContext(input)
    const deterministic = buildDeterministicResponse(message, context)
    if (deterministic.direct) return deterministic.response

    const llmResponse = await this.answerWithLlm(message, context, deterministic.response).catch(() => null)
    if (!llmResponse) return deterministic.response

    return {
      ...deterministic.response,
      text: llmResponse.text || deterministic.response.text,
      follow_up_suggestions: llmResponse.follow_up_suggestions.length > 0
        ? llmResponse.follow_up_suggestions
        : deterministic.response.follow_up_suggestions,
      memory_updates: llmResponse.memory_updates ?? deterministic.response.memory_updates,
    }
  }

  private async answerWithLlm(
    message: string,
    context: AssistantContext,
    fallback: NarrativeAssistantResponse,
  ): Promise<NarrativeAssistantResponse | null> {
    const provider = this.options.llmProvider
    if (!provider?.isReady()) return null
    const result = await provider.complete({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(message, context, fallback) },
      ],
      tools: [],
      timeoutMs: this.options.timeoutMs ?? Number(process.env.NARRATIVE_ASSISTANT_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS || '12000'),
      temperature: 0.55,
      topP: 0.9,
    })
    const parsed = parseLooseJsonObject(result.assistantMessage.content || '')
    const text = normalizeText(readString(parsed?.text)).slice(0, 900)
    if (!text) return null
    return {
      text,
      citations: fallback.citations,
      ui_actions: fallback.ui_actions,
      follow_up_suggestions: readStringArray(parsed?.follow_up_suggestions).slice(0, 4),
      memory_updates: parseMemoryUpdates(parsed?.memory_updates),
    }
  }
}

function buildContext(input: NarrativeAssistantRequest): AssistantContext {
  const state = input.narrative_state ?? null
  const activeIndex = clampIndex(input.client_state?.active_chapter_index ?? 0, state?.path.nodes.length ?? 0)
  const activeNode = state?.path.nodes[activeIndex]
  const activeRegion = activeNode ? findRegion(state, activeNode.region_id) : null
  const activeChapter = activeNode ? findChapter(state, activeNode.region_id) : null
  const pathRegions = state?.path.nodes.map((node) => findRegion(state, node.region_id)).filter((item): item is NarrativeRegion => Boolean(item)) ?? []
  return { state, activeIndex, activeRegion, activeChapter, pathRegions }
}

function buildDeterministicResponse(message: string, context: AssistantContext): { direct: boolean; response: NarrativeAssistantResponse } {
  const text = message.toLowerCase()
  const citations = buildCitations(context)
  const base = buildBaseResponse(context, citations)
  if (!message.trim()) return { direct: true, response: base }

  if (/暂停|停一下|打断|别讲/u.test(text)) {
    return {
      direct: true,
      response: {
        ...base,
        text: '我先帮你暂停解说。你可以继续追问当前片区，准备好了再让我继续。',
        ui_actions: [{ action: 'pause', params: {}, reason: '用户要求暂停当前解说' }],
        follow_up_suggestions: ['当前这里最值得听的是什么？', '这章有哪些网页来源？', '换成更本地人的讲法'],
      },
    }
  }

  if (/继续|接着讲|恢复/u.test(text)) {
    return {
      direct: true,
      response: {
        ...base,
        text: '好，我继续播放当前路线。',
        ui_actions: [{ action: 'resume', params: {}, reason: '用户要求继续解说' }],
      },
    }
  }

  if (/下一|跳过|下一章|下一节/u.test(text)) {
    const next = Math.min(context.activeIndex + 1, Math.max(0, context.pathRegions.length - 1))
    const region = context.pathRegions[next]
    return {
      direct: true,
      response: {
        ...base,
        text: region ? `好的，我带你跳到下一站「${region.display_name}」。` : '当前已经是最后一站了。',
        ui_actions: region ? [{ action: 'jump_to_chapter', params: { index: next }, reason: '用户要求跳到下一站' }] : [],
      },
    }
  }

  if (/上一|前一|回到/u.test(text)) {
    const previous = Math.max(0, context.activeIndex - 1)
    const region = context.pathRegions[previous]
    return {
      direct: true,
      response: {
        ...base,
        text: region ? `我带你回到上一站「${region.display_name}」。` : '当前没有上一站。',
        ui_actions: region ? [{ action: 'jump_to_chapter', params: { index: previous }, reason: '用户要求回到上一站' }] : [],
      },
    }
  }

  const targetRegion = findMentionedRegion(message, context)
  if (targetRegion && /定位|飞到|看一下|在哪|高亮|找到|切到/u.test(text)) {
    return {
      direct: true,
      response: {
        ...base,
        text: `我把地图焦点切到「${targetRegion.display_name}」。你可以继续问它的边界、业态或和其他片区的关系。`,
        ui_actions: [
          { action: 'fly_to', params: { region_id: targetRegion.id }, reason: '用户提到了具体片区并要求定位' },
          { action: 'highlight', params: { region_id: targetRegion.id }, reason: '突出显示用户点名的片区' },
        ],
      },
    }
  }

  const replan = CONTROL_REPLAN_THEME.find((item) => item.pattern.test(message) && /换|按|重新|改成|主题|路线|重讲|生成/u.test(message))
  if (replan) {
    return {
      direct: true,
      response: {
        ...base,
        text: `可以。我建议把探索主题切到「${replan.label}」，重新按这个视角组织路线和讲法。`,
        ui_actions: [{ action: 'request_replan', params: { theme: replan.theme }, reason: `按「${replan.label}」重新分析当前视野` }],
        follow_up_suggestions: ['顺便提高本地人倾向', '候选数量多一点', '网页事实开完整'],
        memory_updates: { user_interests: [replan.label] },
      },
    }
  }

  if (/来源|网页|出处|证据|资料/u.test(text)) {
    return { direct: true, response: buildSourceResponse(context, base) }
  }

  if (/路线|顺序|接下来|后面|为什么这么走/u.test(text)) {
    return { direct: true, response: buildRouteResponse(context, base) }
  }

  if (/业态|商业|吃|餐饮|店|消费|画像/u.test(text)) {
    return { direct: false, response: buildBusinessResponse(context, base) }
  }

  return { direct: false, response: base }
}

function buildBaseResponse(context: AssistantContext, citations: NarrativeAssistantResponse['citations']): NarrativeAssistantResponse {
  const region = context.activeRegion
  const chapter = context.activeChapter
  const names = context.pathRegions.map((item) => item.display_name).slice(0, 6)
  const currentName = region?.display_name || '当前视野'
  const chapterText = summarize(chapter?.text || '')
  const factText = region?.narrative_facts.map((fact) => fact.claim).filter(Boolean).slice(0, 2).join('；') || ''
  return {
    text: chapterText
      ? `现在讲到「${currentName}」。${chapterText}`
      : factText
        ? `现在讲到「${currentName}」。我能看到的确定性线索是：${factText}。`
        : names.length
          ? `我已经读到这条导览路线：${names.join('、')}。你可以问我任一站为什么被选中、有哪些来源，或者让我换一个主题重讲。`
          : '当前还没有可用的 narrative 结果。你可以先分析当前视野，再让我帮你解读片区、来源和路线。',
    citations,
    ui_actions: region ? [{ action: 'highlight', params: { region_id: region.id }, reason: '突出当前讲解片区' }] : [],
    follow_up_suggestions: buildFollowUps(context),
  }
}

function buildSourceResponse(context: AssistantContext, base: NarrativeAssistantResponse): NarrativeAssistantResponse {
  const sources = context.activeChapter?.web_sources || []
  if (sources.length === 0) {
    return {
      ...base,
      text: `「${context.activeRegion?.display_name || '当前章节'}」暂时没有可展示的网页来源，当前回答主要依据本地空间证据和章节事实。`,
      follow_up_suggestions: ['重新开启网页事实增强', '先讲本地空间证据', '换到有来源的章节'],
    }
  }
  const sourceLines = sources.slice(0, 3).map((source, index) => `${index + 1}. ${source.title}${source.snippet ? `：${summarize(source.snippet, 80)}` : ''}`)
  return {
    ...base,
    text: `当前章节有 ${sources.length} 条网页来源可参考：\n${sourceLines.join('\n')}`,
    follow_up_suggestions: ['把这些来源融进解说里', '只讲官方/百科来源', '解释哪些内容来自本地数据'],
  }
}

function buildRouteResponse(context: AssistantContext, base: NarrativeAssistantResponse): NarrativeAssistantResponse {
  const nodes = context.state?.path.nodes || []
  if (nodes.length === 0) return base
  const lines = nodes.slice(0, 8).map((node, index) => {
    const region = findRegion(context.state, node.region_id)
    return `${index + 1}. ${region?.display_name || node.region_id}${node.transition_reason ? `：${node.transition_reason}` : ''}`
  })
  return {
    ...base,
    text: `这条路线现在是这样组织的：\n${lines.join('\n')}\n我会优先保持空间顺路，同时避免连续讲太多同质片区。`,
    follow_up_suggestions: ['换成商业路线', '换成亲子路线', '从当前片区开始重排'],
  }
}

function buildBusinessResponse(context: AssistantContext, base: NarrativeAssistantResponse): NarrativeAssistantResponse {
  const profile = context.activeRegion?.business_profile
  if (!profile) return base
  const mainTypes = profile.dominant_main_types.slice(0, 3).map((item) => item.name).join('、')
  const places = profile.representative_places.slice(0, 4).join('、')
  return {
    ...base,
    text: `从当前可见点簇看，「${context.activeRegion?.display_name}」更明显的业态倾向是${mainTypes || '混合型城市服务'}。${profile.summary_hint || ''}${places ? ` 代表性点位包括 ${places}。` : ''}`,
    follow_up_suggestions: ['按美食路线重讲', '按购物消费重讲', '附近还有哪些支撑点'],
  }
}

function buildCitations(context: AssistantContext): NarrativeAssistantResponse['citations'] {
  const citations: NarrativeAssistantResponse['citations'] = []
  if (context.activeChapter) {
    citations.push({ kind: 'narrative', ref: context.activeChapter.region_id, snippet: summarize(context.activeChapter.text, 120) })
  }
  for (const fact of context.activeRegion?.narrative_facts.slice(0, 3) || []) {
    citations.push({ kind: 'postgis', ref: fact.related_entity.id, snippet: fact.claim })
  }
  for (const source of context.activeChapter?.web_sources?.slice(0, 3) || []) {
    citations.push({ kind: 'web', ref: source.url, snippet: source.title })
  }
  return citations.slice(0, 6)
}

function buildFollowUps(context: AssistantContext): string[] {
  const current = context.activeRegion?.display_name || '当前片区'
  return [
    `${current}为什么被选中？`,
    '这章有哪些网页来源？',
    '按本地人视角重讲',
    '下一站讲哪里？',
  ]
}

function buildSystemPrompt(): string {
  return [
    '你是 GeoLoom narrative 路由里的地图导览 AI 助手。',
    '只能依据用户提供的 narrative_state、章节文本、片区事实、POI 业态画像和网页来源回答。',
    '不能编造不存在的商圈、边界、POI、历史事实或网页来源。',
    '不要使用 score、tier、LOD、route_strategy、节点、样本、权重等内部工程词。',
    '回答要像武汉本地导览朋友，短、准、可继续追问。',
    '只输出 JSON：{"text":"...","follow_up_suggestions":["..."],"memory_updates":{"user_interests":["..."]}}。',
  ].join('\n')
}

function buildUserPrompt(message: string, context: AssistantContext, fallback: NarrativeAssistantResponse): string {
  const state = context.state
  const currentRegion = context.activeRegion
  const currentChapter = context.activeChapter
  const payload = {
    user_message: message,
    current: currentRegion ? {
      id: currentRegion.id,
      name: currentRegion.display_name,
      facts: currentRegion.narrative_facts.map((fact) => fact.claim).slice(0, 5),
      business_profile: currentRegion.business_profile ? {
        summary_hint: currentRegion.business_profile.summary_hint,
        dominant_main_types: currentRegion.business_profile.dominant_main_types.slice(0, 3),
        dominant_sub_types: currentRegion.business_profile.dominant_sub_types.slice(0, 3),
        representative_places: currentRegion.business_profile.representative_places.slice(0, 5),
      } : null,
    } : null,
    chapter: currentChapter ? {
      text: currentChapter.text,
      web_sources: currentChapter.web_sources?.slice(0, 4) || [],
    } : null,
    route: state?.path.nodes.map((node, index) => ({
      index,
      region_id: node.region_id,
      name: findRegion(state, node.region_id)?.display_name || node.region_id,
      transition_reason: node.transition_reason,
    })).slice(0, 10) || [],
    fallback_answer: fallback.text,
  }
  return JSON.stringify(payload)
}

function findRegion(state: NarrativeResponse | null | undefined, regionId: string): NarrativeRegion | null {
  return state?.regions.find((region) => region.id === regionId) ?? null
}

function findChapter(state: NarrativeResponse | null | undefined, regionId: string): NarrativeChapter | null {
  return state?.narration.chapters.find((chapter) => chapter.region_id === regionId) ?? null
}

function findMentionedRegion(message: string, context: AssistantContext): NarrativeRegion | null {
  const normalized = normalizeText(message)
  return context.pathRegions.find((region) => normalized.includes(region.display_name))
    ?? context.state?.regions.find((region) => normalized.includes(region.display_name))
    ?? null
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(length - 1, Math.trunc(index)))
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim()
}

function summarize(text: string, maxLength = 180): string {
  const normalized = normalizeText(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(readString).filter(Boolean)
}

function parseMemoryUpdates(value: unknown): NarrativeAssistantResponse['memory_updates'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const userInterests = readStringArray(record.user_interests)
  const skippedChapters = readStringArray(record.skipped_chapters)
  if (userInterests.length === 0 && skippedChapters.length === 0) return undefined
  return {
    ...(userInterests.length > 0 ? { user_interests: userInterests.slice(0, 6) } : {}),
    ...(skippedChapters.length > 0 ? { skipped_chapters: skippedChapters.slice(0, 6) } : {}),
  }
}

function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim()
  if (fenced) candidates.push(fenced)
  const objectMatch = trimmed.match(/\{[\s\S]*\}/u)?.[0]
  if (objectMatch) candidates.push(objectMatch)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      continue
    }
  }
  return null
}
