import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import { DeterministicRouter } from '../chat/DeterministicRouter.js'
import { SSEWriter } from '../chat/SSEWriter.js'
import type {
  UserLocationContext,
  ChatRequestV4,
  ComparisonPair,
  DeterministicIntent,
  EvidenceView,
  EvidenceItem,
  RenderedAnswer,
  ResolvedAnchor,
  ToolExecutionTrace,
} from '../chat/types.js'
import { EvidenceViewFactory } from '../evidence/EvidenceViewFactory.js'
import { Renderer } from '../evidence/Renderer.js'
import { InMemoryLLMProvider } from '../llm/InMemoryLLMProvider.js'
import { createDefaultLLMProvider } from '../llm/createDefaultLLMProvider.js'
import { buildToolSchemas } from '../llm/toolSchemaBuilder.js'
import type { LLMProvider, ToolCallRequest } from '../llm/types.js'
import { runFunctionCallingLoop } from '../llm/FunctionCallingLoop.js'
import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import { AlivePromptBuilder } from './AlivePromptBuilder.js'
import { ConfidenceGate } from './ConfidenceGate.js'
import { ConversationMemory } from './ConversationMemory.js'
import type { AgentTurnState } from './types.js'
import { SessionManager } from './SessionManager.js'
import { SkillManifestLoader } from '../skills/SkillManifestLoader.js'
import { MemoryManager } from '../memory/MemoryManager.js'
import { ShortTermMemory } from '../memory/ShortTermMemory.js'
import { LongTermMemory } from '../memory/LongTermMemory.js'
import { ProfileManager } from '../memory/ProfileManager.js'
import { RuntimeMetrics } from '../metrics/RuntimeMetrics.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import type { DependencyStatus } from '../integration/dependencyStatus.js'
import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'

const SCHEMA_VERSION = 'v4.agent.v1'
const DEFAULT_POI_COORD_SYS = 'gcj02'

function formatNumericLiteral(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : String(fallback)
}

function hasCoordinates(anchor: ResolvedAnchor | null | undefined): anchor is ResolvedAnchor {
  return Boolean(anchor && Number.isFinite(anchor.lon) && Number.isFinite(anchor.lat))
}

function normalizeCoordSys(value: unknown, fallback = DEFAULT_POI_COORD_SYS) {
  return String(value || fallback).trim().toLowerCase() || fallback
}

function readSpatialContext(request: ChatRequestV4) {
  return request.options?.spatialContext as Record<string, unknown> | undefined
}

function readLonLatCandidate(candidate: unknown) {
  if (Array.isArray(candidate) && candidate.length >= 2) {
    const lon = Number(candidate[0])
    const lat = Number(candidate[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
    return null
  }

  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>
    const lon = Number(record.lon ?? record.lng ?? record.longitude)
    const lat = Number(record.lat ?? record.latitude)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
  }

  return null
}

function readUserLocation(request: ChatRequestV4) {
  const spatialContext = readSpatialContext(request)
  const raw = spatialContext?.userLocation as Record<string, unknown> | undefined
  const lon = Number(raw?.lon ?? raw?.lng ?? raw?.longitude)
  const lat = Number(raw?.lat ?? raw?.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  const accuracyM = Number(raw?.accuracyM ?? raw?.accuracy ?? raw?.accuracy_m)
  return {
    lon,
    lat,
    accuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
    source: String(raw?.source || 'browser_geolocation'),
    capturedAt: String(raw?.capturedAt || raw?.captured_at || ''),
    coordSys: String(raw?.coordSys || raw?.coord_sys || 'wgs84'),
  } satisfies UserLocationContext
}

function readMapViewAnchor(request: ChatRequestV4, role = 'primary'): ResolvedAnchor | null {
  const spatialContext = readSpatialContext(request)
  if (!spatialContext) return null

  const directCenter = readLonLatCandidate(spatialContext.center)
  const viewport = Array.isArray(spatialContext.viewport) ? spatialContext.viewport : []
  const boundary = Array.isArray(spatialContext.boundary) ? spatialContext.boundary : []

  const viewportCenter = viewport.length >= 4
    ? {
      lon: (Number(viewport[0]) + Number(viewport[2])) / 2,
      lat: (Number(viewport[1]) + Number(viewport[3])) / 2,
    }
    : null

  let boundaryCenter = null as { lon: number, lat: number } | null
  if (boundary.length >= 3) {
    const points = boundary
      .map((point) => readLonLatCandidate(point))
      .filter((point): point is { lon: number, lat: number } => Boolean(point))
    if (points.length > 0) {
      boundaryCenter = {
        lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
        lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      }
    }
  }

  const center = directCenter || viewportCenter || boundaryCenter
  if (!center || !Number.isFinite(center.lon) || !Number.isFinite(center.lat)) {
    return null
  }

  return {
    place_name: '当前区域',
    display_name: '当前区域',
    role,
    source: 'map_view',
    resolved_place_name: '当前区域',
    poi_id: null,
    lon: center.lon,
    lat: center.lat,
    coord_sys: normalizeCoordSys(spatialContext.coordSys || spatialContext.coord_sys, DEFAULT_POI_COORD_SYS),
  }
}

function buildUserLocationAnchor(userLocation: UserLocationContext, role = 'primary'): ResolvedAnchor {
  return {
    place_name: '当前位置',
    display_name: '当前位置',
    role,
    source: 'user_location',
    resolved_place_name: '当前位置',
    poi_id: null,
    lon: userLocation.lon,
    lat: userLocation.lat,
    coord_sys: String(userLocation.coordSys || 'wgs84').trim().toLowerCase() || 'wgs84',
  }
}

function normalizePoiRows(rows: Record<string, unknown>[] = []): EvidenceItem[] {
  return rows.map((row) => ({
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    coordSys: normalizeCoordSys(row.coord_sys || row.coordSys, DEFAULT_POI_COORD_SYS),
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
    meta: row,
  }))
}

function readCategoryValue(row: Record<string, unknown> = {}, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || '').trim()
    if (value) return value
  }
  return ''
}

export interface GeoLoomAgentOptions {
  registry: SkillRegistry
  version: string
  provider?: LLMProvider
  manifestLoader?: SkillManifestLoader
  memory?: MemoryManager
  sessionManager?: SessionManager
  conversationMemory?: ConversationMemory
  evidenceFactory?: EvidenceViewFactory
  renderer?: Renderer
  router?: DeterministicRouter
  alivePromptBuilder?: AlivePromptBuilder
  confidenceGate?: ConfidenceGate
  metrics?: RuntimeMetrics
}

export class GeoLoomAgent {
  private readonly router: DeterministicRouter
  private readonly provider: LLMProvider
  private readonly manifestLoader: SkillManifestLoader
  private readonly memory: MemoryManager
  private readonly sessionManager: SessionManager
  private readonly conversationMemory: ConversationMemory
  private readonly evidenceFactory: EvidenceViewFactory
  private readonly renderer: Renderer
  private readonly alivePromptBuilder: AlivePromptBuilder
  private readonly confidenceGate: ConfidenceGate
  private readonly metrics: RuntimeMetrics

  constructor(private readonly options: GeoLoomAgentOptions) {
    this.router = options.router || new DeterministicRouter()
    this.provider = options.provider || createDefaultLLMProvider()
    this.manifestLoader = options.manifestLoader || new SkillManifestLoader({
      rootDir: resolveResourceUrl(import.meta.url, ['../../SKILLS/', '../../../SKILLS/']),
    })
    const sharedShortTerm = new ShortTermMemory()
    this.memory = options.memory || new MemoryManager({
      shortTerm: sharedShortTerm,
      longTerm: new LongTermMemory({
        dataDir: resolveResourceUrl(import.meta.url, ['../../data/memory/', '../../../data/memory/']),
      }),
      profiles: new ProfileManager({
        profileDir: resolveResourceUrl(import.meta.url, ['../../profiles/', '../../../profiles/']),
      }),
    })
    this.sessionManager = options.sessionManager || new SessionManager({ memory: sharedShortTerm })
    this.conversationMemory = options.conversationMemory || new ConversationMemory()
    this.evidenceFactory = options.evidenceFactory || new EvidenceViewFactory()
    this.renderer = options.renderer || new Renderer()
    this.alivePromptBuilder = options.alivePromptBuilder || new AlivePromptBuilder()
    this.confidenceGate = options.confidenceGate || new ConfidenceGate()
    this.metrics = options.metrics || new RuntimeMetrics()
  }

  createWriter(stream: Writable, traceId = randomUUID()) {
    return new SSEWriter({
      stream,
      traceId,
      schemaVersion: SCHEMA_VERSION,
    })
  }

  async getHealth() {
    const providerStatus = this.provider.getStatus()
    const memoryHealth = await this.memory.getHealth()
    const dependencies: Record<string, DependencyStatus> = {
      ...memoryHealth.dependencies,
    }
    const skills = this.options.registry.list()
      .map((summary) => this.options.registry.get(summary.name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))

    for (const skill of skills) {
      if (!skill.getStatus) continue
      Object.assign(dependencies, await skill.getStatus())
    }

    const degradedDependencies = Object.values(dependencies)
      .filter((status) => status.degraded || !status.ready)
      .map((status) => status.name)

    if (!providerStatus.ready) {
      degradedDependencies.unshift('llm_provider')
    }

    return {
      provider_ready: providerStatus.ready,
      llm: providerStatus,
      memory: memoryHealth,
      metrics: this.metrics.snapshot(),
      dependencies,
      degraded_dependencies: [...new Set(degradedDependencies)],
    }
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    const startedAt = Date.now()
    const traceId = writer.traceId
    const requestId = String(request.options?.requestId || traceId)
    const session = await this.sessionManager.getOrCreate({
      requestId,
      sessionId: request.options?.sessionId,
    })
    const logger = createLogger().child({
      traceId,
      requestId,
      sessionId: session.id,
    })
    const skillContext = createSkillExecutionContext({
      traceId,
      requestId,
      sessionId: session.id,
      logger,
    })
    const activeProvider = this.provider.isReady() ? this.provider : new InMemoryLLMProvider()
    const intent = this.router.route(request)
    const requestUserLocation = readUserLocation(request)
    const requestMapViewAnchor = readMapViewAnchor(request)
    const state: AgentTurnState = {
      requestId,
      traceId,
      sessionId: session.id,
      toolCalls: [],
      anchors: {},
      sqlValidationAttempts: 0,
      sqlValidationPassed: 0,
    }
    if (intent.anchorSource === 'user_location' && requestUserLocation) {
      state.anchors.primary = buildUserLocationAnchor(requestUserLocation)
    } else if (intent.anchorSource === 'map_view' && requestMapViewAnchor) {
      state.anchors.primary = requestMapViewAnchor
    }
    const previewAnchorLabel = intent.anchorSource === 'user_location' && requestUserLocation
      ? '当前位置'
      : intent.placeName

    await writer.trace({
      request_id: requestId,
      session_id: session.id,
      provider_ready: this.provider.isReady(),
      version: this.options.version,
    })
    await writer.job({
      mode: this.provider.isReady() ? 'agent_full_loop' : 'deterministic_visible_loop',
      provider_ready: this.provider.isReady(),
      version: this.options.version,
      session_id: session.id,
    })
    await writer.stage('intent')
    await writer.thinking({
      status: 'start',
      message: '正在识别问题类型与锚点...',
    })
    await writer.intentPreview({
      rawAnchor: previewAnchorLabel,
      normalizedAnchor: previewAnchorLabel,
      displayAnchor: previewAnchorLabel,
      targetCategory: intent.targetCategory,
      confidence: intent.queryType === 'unsupported' ? 0.35 : 0.92,
      needsClarification: intent.needsClarification,
      clarificationHint: intent.clarificationHint,
      parserModel: this.provider.isReady() ? 'agent-router' : 'deterministic-router',
      parserProvider: 'rule',
    })

    if (intent.queryType === 'unsupported' || intent.needsClarification) {
      const answer = intent.clarificationHint || this.buildUnsupportedAnswer()
      await this.finishWithoutEvidence({
        writer,
        answer,
        intent,
        state,
        startedAt,
        providerReady: this.provider.isReady(),
      })
      return
    }

    await writer.stage('memory')
    await writer.thinking({
      status: 'start',
      message: '正在读取会话上下文...',
    })
    const snapshot = this.conversationMemory.summarize(await this.memory.getSnapshot(session.id))
    const profiles = await this.memory.loadProfiles()
    const manifests = await this.manifestLoader.loadAll()
    const skills = this.options.registry.list()
      .map((summary) => this.options.registry.get(summary.name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))
    const tools = buildToolSchemas({ skills, manifests })
    const systemPrompt = this.alivePromptBuilder.build({
      sessionId: session.id,
      profiles,
      memory: {
        summary: snapshot.summary,
        recentTurns: snapshot.recentTurns,
      },
      skillSnippets: manifests.map((manifest) => manifest.promptSnippet),
    })

    await writer.stage('tool_select')
    await writer.thinking({
      status: 'start',
      message: '正在规划本轮 skill 调用...',
    })

    let execution: Awaited<ReturnType<typeof runFunctionCallingLoop>>
    try {
      execution = await runFunctionCallingLoop({
        provider: activeProvider,
        tools,
        maxRounds: 4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: this.router.extractLastUserText(request.messages) },
        ],
        onToolCall: async (call) => {
          await writer.stage('tool_run')
          await writer.thinking({
            status: 'start',
          message: `正在执行 ${call.name}.${String(call.arguments.action || '')}...`,
        })
          const result = await this.executeToolCall(call, intent, state, skillContext)
          return {
            content: JSON.stringify(result.content),
            trace: result.trace,
          }
        },
      })
    } catch (error) {
      await writer.thinking({
        status: 'start',
        message: 'LLM 调用异常，已切换到确定性证据摘要模式。',
      })
      execution = await runFunctionCallingLoop({
        provider: new InMemoryLLMProvider(),
        tools,
        maxRounds: 4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: this.router.extractLastUserText(request.messages) },
        ],
        onToolCall: async (call) => {
          await writer.stage('tool_run')
          await writer.thinking({
            status: 'start',
          message: `正在执行 ${call.name}.${String(call.arguments.action || '')}...`,
        })
          const result = await this.executeToolCall(call, intent, state, skillContext)
          return {
            content: JSON.stringify(result.content),
            trace: result.trace,
          }
        },
      })
    }

    const recoveredCoreEvidence = await this.recoverCoreSpatialEvidenceIfNeeded({
      intent,
      state,
      writer,
      context: skillContext,
    })

    const primaryAnchor = state.anchors.primary
    const secondaryAnchor = state.anchors.secondary
    const evidenceView = await this.buildEvidenceView(intent, state, primaryAnchor, secondaryAnchor)
    state.evidenceView = evidenceView

    const decision = this.confidenceGate.evaluate({
      anchorResolved: intent.queryType === 'similar_regions' || hasCoordinates(primaryAnchor),
      evidenceCount: evidenceView.items.length || evidenceView.pairs?.length || evidenceView.regions?.length || 0,
      hasConflict: false,
    })

    await writer.stage('evidence')
    await writer.thinking({
      status: 'start',
      message: '正在整理证据视图...',
    })

    if (evidenceView.boundary) {
      await writer.boundary(evidenceView.boundary)
    }
    if (evidenceView.spatialClusters) {
      await writer.spatialClusters(evidenceView.spatialClusters)
    }
    if (evidenceView.vernacularRegions?.length) {
      await writer.vernacularRegions(evidenceView.vernacularRegions)
    }
    if (evidenceView.fuzzyRegions?.length) {
      await writer.fuzzyRegions(evidenceView.fuzzyRegions)
    }

    const rendered = this.renderAnswer(evidenceView)
    const evidenceCount = rendered.pois.length
      || evidenceView.pairs?.length
      || evidenceView.regions?.length
      || 0
    const llmAnswer = String(execution.assistantMessage?.content || '').trim()
    const shouldPreferRenderedAnswer = recoveredCoreEvidence
    const answer = decision.status === 'allow'
      ? (llmAnswer && activeProvider.isReady() && !shouldPreferRenderedAnswer ? llmAnswer : rendered.answer)
      : (decision.message || rendered.answer)

    await writer.stage('answer')
    await writer.thinking({
      status: 'end',
      message: '证据整理完成，正在生成结果...',
    })
    await writer.pois(rendered.pois)

    const stats = this.buildStats({
      intent,
      startedAt,
      traceId,
      sessionId: session.id,
      providerReady: this.provider.isReady(),
      evidenceCount,
      anchor: primaryAnchor || null,
      toolCalls: state.toolCalls,
      decision: decision.reason,
    })

    await writer.stats(stats)
    await writer.refinedResult({
      answer,
      results: {
        pois: rendered.pois,
        stats,
        evidence_view: evidenceView,
      },
      intent: {
        queryType: intent.queryType,
        intentMode: intent.intentMode,
        placeName: intent.placeName,
        targetCategory: intent.targetCategory,
      },
      tool_calls: state.toolCalls,
      trace_id: traceId,
    })
    this.recordRequestMetrics({
      startedAt,
      state,
      answer,
      evidenceView,
    })
    await writer.done({
      duration_ms: Date.now() - startedAt,
      session_id: session.id,
    })

    await this.memory.recordTurn(session.id, {
      traceId,
      userQuery: this.router.extractLastUserText(request.messages),
      answer,
      intent: {
        queryType: intent.queryType,
        targetCategory: intent.targetCategory,
      },
      createdAt: new Date().toISOString(),
    })
  }

  private async finishWithoutEvidence(input: {
    writer: SSEWriter
    answer: string
    intent: DeterministicIntent
    state: AgentTurnState
    startedAt: number
    providerReady: boolean
  }) {
    await input.writer.stage('answer')
    await input.writer.thinking({
      status: 'end',
      message: '当前问题需要补充信息后才能继续。',
    })
    const stats = this.buildStats({
      intent: input.intent,
      startedAt: input.startedAt,
      traceId: input.state.traceId,
      sessionId: input.state.sessionId,
      providerReady: input.providerReady,
      evidenceCount: 0,
      anchor: null,
      toolCalls: input.state.toolCalls,
      decision: input.intent.needsClarification ? 'unresolved_anchor' : 'insufficient_evidence',
    })
    await input.writer.stats(stats)
    await input.writer.refinedResult({
      answer: input.answer,
      results: {
        pois: [],
        stats,
        evidence_view: {
          type: 'poi_list',
          anchor: {
            placeName: input.intent.placeName || '',
            displayName: input.intent.placeName || '',
            resolvedPlaceName: input.intent.placeName || '',
          },
          items: [],
          meta: {},
        },
      },
      intent: {
        queryType: input.intent.queryType,
        intentMode: input.intent.intentMode,
        placeName: input.intent.placeName,
        targetCategory: input.intent.targetCategory,
      },
      tool_calls: input.state.toolCalls,
      trace_id: input.state.traceId,
    })
    this.recordRequestMetrics({
      startedAt: input.startedAt,
      state: input.state,
      answer: input.answer,
      evidenceView: input.state.evidenceView,
    })
    await input.writer.done({
      duration_ms: Date.now() - input.startedAt,
      session_id: input.state.sessionId,
    })
  }

  private async executeToolCall(
    call: ToolCallRequest,
    intent: DeterministicIntent,
    state: AgentTurnState,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const startedAt = Date.now()
    const skill = this.options.registry.get(call.name)
    const payload = (call.arguments.payload || {}) as Record<string, unknown>
    const action = String(call.arguments.action || '')
    if (!skill) {
      const trace: ToolExecutionTrace = {
        id: call.id,
        skill: call.name,
        action,
        status: 'error',
        payload,
        error: 'Skill not found',
        latency_ms: Date.now() - startedAt,
      }
      state.toolCalls.push(trace)
      return {
        content: { ok: false, error: 'Skill not found' },
        trace,
      }
    }

    let result: Awaited<ReturnType<SkillDefinition['execute']>>
    if (
      call.name === 'postgis'
      && action === 'resolve_anchor'
      && (intent.anchorSource === 'user_location' || intent.anchorSource === 'map_view')
      && String(payload.role || 'primary') === 'primary'
      && hasCoordinates(state.anchors.primary)
    ) {
      result = {
        ok: true,
        data: {
          anchor: state.anchors.primary,
          role: 'primary',
        },
        meta: {
          action: 'resolve_anchor',
          audited: true,
          synthetic: true,
        },
      }
    } else if (call.name === 'postgis' && action === 'execute_spatial_sql' && payload.template) {
      result = await this.executePostgisTemplate(skill, intent, state, payload, context)
    } else {
      result = await skill.execute(action, payload, context)
    }

    const anchorResult = result.data as { anchor?: ResolvedAnchor, role?: string } | undefined
    if (call.name === 'postgis' && action === 'resolve_anchor' && result.ok && anchorResult?.anchor) {
      const anchor = anchorResult.anchor
      const role = anchor.role || String(payload.role || 'primary')
      state.anchors[role] = anchor
      anchorResult.role = role
    }

    const trace: ToolExecutionTrace = {
      id: call.id,
      skill: call.name,
      action,
      status: result.ok ? 'done' : 'error',
      payload,
      result: result.data,
      error: result.error?.message || null,
      latency_ms: Date.now() - startedAt,
    }
    state.toolCalls.push(trace)

    return {
      content: result.data || result.error || {},
      trace,
    }
  }

  private async executePostgisTemplate(
    skill: SkillDefinition,
    intent: DeterministicIntent,
    state: AgentTurnState,
    payload: Record<string, unknown>,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const template = String(payload.template || '')
    if (template === 'compare_places') {
      const primary = state.anchors.primary
      const secondary = state.anchors.secondary
      if (!hasCoordinates(primary) || !hasCoordinates(secondary)) {
        return {
          ok: false,
          error: {
            code: 'missing_anchor',
            message: 'Comparison requires two resolved anchors',
          },
          meta: {
            action: 'execute_spatial_sql',
            audited: true,
          },
        }
      }

      const comparisonCategoryKey = String(payload.category_key || payload.categoryKey || intent.categoryKey || 'food')
      const comparisonLimit = Number(payload.limit || 10)
      const primaryRows = await this.executeTemplateSQL(skill, intent, primary, comparisonCategoryKey, comparisonLimit, state, context)
      const secondaryRows = await this.executeTemplateSQL(skill, intent, secondary, comparisonCategoryKey, comparisonLimit, state, context)
      const comparisonPairs: ComparisonPair[] = [
        {
          label: primary.resolved_place_name,
          anchor: {
            placeName: primary.place_name,
            displayName: primary.display_name,
            resolvedPlaceName: primary.resolved_place_name,
            lon: primary.lon,
            lat: primary.lat,
            source: primary.source,
          },
          value: primaryRows.length,
          items: normalizePoiRows(primaryRows),
        },
        {
          label: secondary.resolved_place_name,
          anchor: {
            placeName: secondary.place_name,
            displayName: secondary.display_name,
            resolvedPlaceName: secondary.resolved_place_name,
            lon: secondary.lon,
            lat: secondary.lat,
            source: secondary.source,
          },
          value: secondaryRows.length,
          items: normalizePoiRows(secondaryRows),
        },
      ]

      return {
        ok: true,
        data: {
          comparison_pairs: comparisonPairs,
        },
        meta: {
          action: 'execute_spatial_sql',
          audited: true,
        },
      }
    }

    const anchor = state.anchors.primary
    if (!hasCoordinates(anchor)) {
      return {
        ok: false,
        error: {
          code: 'missing_anchor',
          message: 'SQL template execution requires a resolved anchor',
        },
        meta: {
          action: 'execute_spatial_sql',
          audited: true,
        },
      }
    }

    const rows = await this.executeTemplateSQL(
      skill,
      intent,
      anchor,
      String(payload.category_key || payload.categoryKey || intent.categoryKey || ''),
      Number(payload.limit || 10),
      state,
      context,
    )

    return {
      ok: true,
      data: {
        rows,
        meta: {
          template,
        },
      },
      meta: {
        action: 'execute_spatial_sql',
        audited: true,
      },
    }
  }

  private async executeTemplateSQL(
    skill: SkillDefinition,
    intent: DeterministicIntent,
    anchor: ResolvedAnchor,
    categoryKey: string,
    limit: number,
    state: AgentTurnState,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const sql = this.buildTemplateSQL(intent, anchor, categoryKey, limit)
    const validation = await skill.execute('validate_spatial_sql', { sql }, context)
    state.sqlValidationAttempts += 1
    if (validation.ok) {
      state.sqlValidationPassed += 1
    } else {
      return []
    }
    const execution = await skill.execute('execute_spatial_sql', { sql }, context)
    const rows = (execution.data as { rows?: Record<string, unknown>[] } | undefined)?.rows || []

    if (intent.queryType === 'nearest_station' && rows.length > 0) {
      const routeSkill = this.options.registry.get('route_distance')
      if (routeSkill && hasCoordinates(anchor)) {
        const route = await routeSkill.execute('get_multi_destination_matrix', {
          origin: {
            type: 'Point',
            coordinates: [anchor.lon!, anchor.lat!],
          },
          destinations: rows.map((row, index) => ({
            id: String(row.id || index),
            type: 'Point',
            coordinates: [Number(row.longitude), Number(row.latitude)],
          })),
          mode: 'walking',
        }, context)

        const ranked = (route.data as { results?: Array<{ id: string, distance_m: number, duration_min: number, rank: number }> } | undefined)?.results || []
        return rows.map((row) => {
          const match = ranked.find((item) => item.id === String(row.id))
          return {
            ...row,
            distance_m: match?.distance_m ?? row.distance_m,
            duration_min: match?.duration_min ?? null,
            rank: match?.rank ?? null,
          }
        })
      }
    }

    return rows
  }

  private buildTemplateSQL(
    intent: DeterministicIntent,
    anchor: ResolvedAnchor,
    categoryKey: string,
    limit: number,
  ) {
    const point = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(anchor.lon)}, ${formatNumericLiteral(anchor.lat)}), 4326)::geography`
    const effectiveLimit = categoryKey === 'metro_station' && intent.queryType === 'nearby_poi'
      ? Math.max(limit, 12)
      : Math.max(limit, 1)
    const baseSelect = [
      'SELECT id, name, category_main, category_sub, longitude, latitude,',
      `  ST_Distance(geom::geography, ${point}) AS distance_m`,
      'FROM pois',
      `WHERE ST_DWithin(geom::geography, ${point}, ${intent.queryType === 'nearest_station' ? 3000 : intent.radiusM})`,
    ]

    const filters: string[] = []
    if (intent.queryType === 'nearest_station' || categoryKey === 'metro_station') {
      filters.push(`AND category_main = '交通设施服务'`)
      filters.push(`AND category_sub = '地铁站'`)
      return [
        ...baseSelect,
        ...filters,
        'ORDER BY distance_m ASC',
        `LIMIT ${effectiveLimit}`,
      ].join('\n')
    }

    if (categoryKey === 'coffee') {
      filters.push(`AND category_main = '餐饮美食'`)
      filters.push(`AND category_sub = '咖啡'`)
    } else if (categoryKey === 'food') {
      filters.push(`AND category_main = '餐饮美食'`)
    }

    return [
      ...baseSelect,
      ...filters,
      'ORDER BY distance_m ASC',
      `LIMIT ${effectiveLimit}`,
    ].join('\n')
  }

  private async buildEvidenceView(
    intent: DeterministicIntent,
    state: AgentTurnState,
    anchor?: ResolvedAnchor,
    secondaryAnchor?: ResolvedAnchor,
  ) {
    const fallbackAnchor: ResolvedAnchor = anchor || {
      place_name: intent.placeName || '',
      display_name: intent.placeName || '',
      role: 'primary',
      source: 'fallback',
      resolved_place_name: intent.placeName || '',
      poi_id: null,
    }
    const latestPostgisRows = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'postgis' && trace.action === 'execute_spatial_sql' && trace.status === 'done')
      ?.result as { rows?: Record<string, unknown>[], comparison_pairs?: ComparisonPair[] } | undefined
    const latestVector = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'spatial_vector' && trace.action === 'search_similar_regions' && trace.status === 'done')
      ?.result as { regions?: Array<{ name: string, score: number, summary: string }> } | undefined

    if (intent.queryType === 'compare_places' && secondaryAnchor) {
      return this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        secondaryAnchor,
        pairs: latestPostgisRows?.comparison_pairs || [],
      })
    }

    if (intent.queryType === 'similar_regions') {
      return this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        items: (latestVector?.regions || []).map((region) => ({
          name: region.name,
          score: region.score,
          meta: {
            summary: region.summary,
          },
        })),
      })
    }

    if (intent.queryType === 'area_overview') {
      return this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        rows: latestPostgisRows?.rows || [],
        items: normalizePoiRows(latestPostgisRows?.rows || []),
      })
    }

    return this.evidenceFactory.create({
      intent,
      anchor: fallbackAnchor,
      rows: latestPostgisRows?.rows || [],
      items: normalizePoiRows(latestPostgisRows?.rows || []),
    })
  }

  private async recoverCoreSpatialEvidenceIfNeeded(input: {
    intent: DeterministicIntent
    state: AgentTurnState
    writer: SSEWriter
    context: ReturnType<typeof createSkillExecutionContext>
  }) {
    const { intent, state, writer, context } = input
    if (!['nearby_poi', 'nearest_station', 'compare_places', 'area_overview'].includes(intent.queryType)) {
      return false
    }

    const needsPrimaryAnchor = Boolean(intent.placeName) && !hasCoordinates(state.anchors.primary)
    const needsSecondaryAnchor = intent.queryType === 'compare_places'
      && Boolean(intent.secondaryPlaceName)
      && !hasCoordinates(state.anchors.secondary)
    const needsDeterministicSql = !this.hasAlignedCorePostgisEvidence(intent, state)
      && (
        intent.queryType === 'nearby_poi'
        || intent.queryType === 'nearest_station'
        || intent.queryType === 'compare_places'
        || intent.queryType === 'area_overview'
      )

    if (!needsPrimaryAnchor && !needsSecondaryAnchor && !needsDeterministicSql) {
      return false
    }

    let recovered = false

    await writer.stage('tool_run')
    await writer.thinking({
      status: 'start',
      message: '核心空间证据不足，正在切换确定性 postgis 兜底...',
    })

    if (needsPrimaryAnchor && intent.placeName) {
      await this.executeToolCall({
        id: `fallback_resolve_primary_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'resolve_anchor',
          payload: {
            place_name: intent.placeName,
            role: 'primary',
          },
        },
      }, intent, state, context)
      recovered = true
    }

    if (needsSecondaryAnchor && intent.secondaryPlaceName) {
      await this.executeToolCall({
        id: `fallback_resolve_secondary_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'resolve_anchor',
          payload: {
            place_name: intent.secondaryPlaceName,
            role: 'secondary',
          },
        },
      }, intent, state, context)
      recovered = true
    }

    if (!needsDeterministicSql) {
      return recovered
    }

    if (intent.queryType === 'compare_places') {
      if (!hasCoordinates(state.anchors.primary) || !hasCoordinates(state.anchors.secondary)) {
        return recovered
      }

      await this.executeToolCall({
        id: `fallback_compare_sql_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'execute_spatial_sql',
          payload: {
            template: 'compare_places',
            category_key: intent.categoryKey || 'food',
            limit: 10,
          },
        },
      }, intent, state, context)
      return true
    }

    if (!hasCoordinates(state.anchors.primary)) {
      return recovered
    }

    await this.executeToolCall({
      id: `fallback_core_sql_${state.toolCalls.length + 1}`,
      name: 'postgis',
      arguments: {
        action: 'execute_spatial_sql',
        payload: {
          template: intent.queryType === 'nearest_station'
            ? 'nearest_station'
            : intent.queryType === 'area_overview'
              ? 'area_overview'
              : 'nearby_poi',
          category_key: intent.categoryKey || '',
          limit: intent.queryType === 'nearest_station'
            ? 1
            : intent.queryType === 'area_overview'
              ? 80
              : 5,
        },
      },
    }, intent, state, context)
    return true
  }

  private hasAlignedCorePostgisEvidence(intent: DeterministicIntent, state: AgentTurnState) {
    const latestPostgisResult = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'postgis' && trace.action === 'execute_spatial_sql' && trace.status === 'done')
      ?.result as { rows?: Record<string, unknown>[], comparison_pairs?: ComparisonPair[] } | undefined

    if (!latestPostgisResult) {
      return false
    }

    if (intent.queryType === 'compare_places') {
      const pairs = latestPostgisResult.comparison_pairs || []
      if (pairs.length === 0) return false
      if (!intent.categoryKey) return true
      return pairs.every((pair) => pair.items.some((item) => this.matchesIntentCategory(
        intent.categoryKey || '',
        (item.meta as Record<string, unknown> | undefined) || {
          category_main: item.categoryMain,
          category_sub: item.categorySub || item.category,
        },
      )))
    }

    const rows = latestPostgisResult.rows || []
    if (rows.length === 0) {
      return false
    }

    if (!intent.categoryKey) {
      return true
    }

    return rows.some((row) => this.matchesIntentCategory(intent.categoryKey || '', row))
  }

  private matchesIntentCategory(categoryKey: string, row: Record<string, unknown> = {}) {
    const categoryMain = readCategoryValue(row, ['category_main', 'categoryMain'])
    const categorySub = readCategoryValue(row, ['category_sub', 'categorySub', 'category'])

    if (categoryKey === 'coffee') {
      return categoryMain === '餐饮美食' && categorySub === '咖啡'
    }

    if (categoryKey === 'food') {
      return categoryMain === '餐饮美食'
    }

    if (categoryKey === 'metro_station') {
      return categoryMain === '交通设施服务' && categorySub === '地铁站'
    }

    return true
  }

  private renderAnswer(view: EvidenceView): RenderedAnswer {
    const answer = this.renderer.render(view)
    const pois = view.items
    return {
      answer,
      summary: answer,
      pois,
      stats: {
        result_count: pois.length,
        query_type: view.meta.queryType,
      },
    }
  }

  private buildStats(input: {
    intent: DeterministicIntent
    startedAt: number
    traceId: string
    sessionId: string
    providerReady: boolean
    evidenceCount: number
    anchor: ResolvedAnchor | null
    toolCalls: ToolExecutionTrace[]
    decision: string
  }) {
    const fallbackAnchorCoordSys = input.intent.anchorSource === 'user_location' ? 'wgs84' : DEFAULT_POI_COORD_SYS
    return {
      query_type: input.intent.queryType,
      intent_mode: input.intent.intentMode,
      result_count: input.evidenceCount,
      anchor_name: input.anchor?.resolved_place_name || input.intent.placeName || null,
      anchor_lon: input.anchor?.lon ?? null,
      anchor_lat: input.anchor?.lat ?? null,
      anchor_coord_sys: normalizeCoordSys(input.anchor?.coord_sys, fallbackAnchorCoordSys),
      target_category: input.intent.targetCategory || null,
      latency_ms: Date.now() - input.startedAt,
      version: this.options.version,
      trace_id: input.traceId,
      session_id: input.sessionId,
      provider_ready: input.providerReady,
      tool_call_count: input.toolCalls.length,
      confidence_gate: input.decision,
    }
  }

  private recordRequestMetrics(input: {
    startedAt: number
    state: AgentTurnState
    answer: string
    evidenceView?: EvidenceView
  }) {
    this.metrics.recordRequest({
      latencyMs: Date.now() - input.startedAt,
      sqlValidated: input.state.sqlValidationAttempts > 0,
      sqlAccepted: input.state.sqlValidationAttempts > 0
        && input.state.sqlValidationAttempts === input.state.sqlValidationPassed,
      answerGrounded: this.isAnswerGrounded(input.answer, input.evidenceView),
    })
  }

  private isAnswerGrounded(answer: string, evidenceView?: EvidenceView) {
    const normalizedAnswer = String(answer || '').trim().toLowerCase()
    if (!normalizedAnswer || !evidenceView) {
      return false
    }

    const hasEvidence = evidenceView.items.length > 0
      || (evidenceView.pairs?.length || 0) > 0
      || (evidenceView.regions?.length || 0) > 0
    if (!hasEvidence) {
      return false
    }

    const keywords = new Set<string>()
    const pushKeyword = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase()
      if (normalized) {
        keywords.add(normalized)
      }
    }

    pushKeyword(evidenceView.anchor.placeName)
    pushKeyword(evidenceView.anchor.displayName)
    pushKeyword(evidenceView.anchor.resolvedPlaceName)

    for (const item of evidenceView.items) {
      pushKeyword(item.name)
    }
    for (const pair of evidenceView.pairs || []) {
      pushKeyword(pair.label)
      pushKeyword(pair.anchor.placeName)
      pushKeyword(pair.anchor.displayName)
      pushKeyword(pair.anchor.resolvedPlaceName)
      for (const item of pair.items) {
        pushKeyword(item.name)
      }
    }
    for (const region of evidenceView.regions || []) {
      pushKeyword(region.name)
    }

    return [...keywords].some((keyword) => normalizedAnswer.includes(keyword))
  }

  private buildUnsupportedAnswer() {
    return '当前 V4 已支持附近 POI、最近地铁站、当前区域洞察、相似片区和双地点比较这几类问题。你可以继续给我一个明确地点，或者直接让我读懂当前区域。'
  }
}
