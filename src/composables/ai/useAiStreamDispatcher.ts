import type { Ref } from 'vue'

type PlainObject = Record<string, unknown>

interface AssistantMessage extends PlainObject {
  role?: string
  content?: string
  intentMeta?: PlainObject
  intentPreview?: PlainObject
  queryType?: string
  queryPlan?: unknown
  intentMode?: string
  traceId?: string
  schemaVersion?: string
  capabilities?: string[]
  prefetchDebug?: PlainObject
  isThinking?: boolean
  isStreaming?: boolean
  thinkingMessage?: string
  reasoningContent?: string
  boundary?: unknown
  previewBoundary?: unknown
  previewSource?: string
  spatialClusters?: PlainObject
  vernacularRegions?: unknown[]
  fuzzyRegions?: unknown[]
  analysisStats?: PlainObject
  modelTiming?: PlainObject
  pois?: unknown[]
  progress?: unknown
  schemaWarning?: PlainObject
}

interface NormalizedRefinedResultEvidence {
  boundary?: unknown
  spatialClusters?: PlainObject | null
  vernacularRegions: unknown[]
  fuzzyRegions: unknown[]
  stats?: PlainObject | null
  intent?: PlainObject | null
}

interface DispatchMetaEventArgs {
  type: string
  data: unknown
  aiMessageIndex: number
  fallbackIntentMode?: string
}

interface UseAiStreamDispatcherArgs {
  messagesRef: Ref<AssistantMessage[]>
  extractedPOIsRef: Ref<unknown[]>
  emit: (eventName: string, payload?: unknown) => void
  normalizeRefinedResultEvidence: (payload: unknown) => NormalizedRefinedResultEvidence
  toEmbeddedIntentMode: (intentMode?: unknown, queryType?: unknown) => string
}

function asPlainObject(value: unknown): PlainObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function useAiStreamDispatcher({
  messagesRef,
  extractedPOIsRef,
  emit,
  normalizeRefinedResultEvidence,
  toEmbeddedIntentMode
}: UseAiStreamDispatcherArgs) {
  function toBooleanOrNull(value: unknown): boolean | null {
    if (value === true) return true
    if (value === false) return false
    return null
  }

  function toFiniteNumberOrNull(value: unknown): number | null {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  function resolvePrefetchStatusTag(prefetchDebug: PlainObject = {}): string {
    if (prefetchDebug.degraded === true) return 'degraded'
    if (prefetchDebug.wasted === true) return 'wasted'
    if (prefetchDebug.degraded === false || prefetchDebug.wasted === false) return 'effective'
    return 'unknown'
  }

  function extractPrefetchDebugState(payload: unknown = {}): PlainObject | null {
    const root = asPlainObject(payload)
    const results = asPlainObject(root.results)
    const rootStats = asPlainObject(root.stats)
    const statsSource = (
      (results && typeof results === 'object' ? asPlainObject(results.stats) : null)
      || (rootStats && typeof rootStats === 'object' ? rootStats : null)
      || null
    )
    const diagnosticsSource = root.diagnostics && typeof root.diagnostics === 'object'
      ? asPlainObject(root.diagnostics)
      : null
    const prefetchDiag = diagnosticsSource?.prefetch && typeof diagnosticsSource.prefetch === 'object'
      ? asPlainObject(diagnosticsSource.prefetch)
      : null

    const degraded = toBooleanOrNull(
      statsSource?.prefetch_degraded
      ?? prefetchDiag?.prefetch_degraded
      ?? root.prefetch_degraded
    )
    const wasted = toBooleanOrNull(
      statsSource?.prefetch_wasted
      ?? prefetchDiag?.prefetch_wasted
      ?? root.prefetch_wasted
    )
    const overlapDeltaMs = toFiniteNumberOrNull(
      statsSource?.prefetch_overlap_delta_ms
      ?? prefetchDiag?.prefetch_overlap_delta_ms
      ?? root.prefetch_overlap_delta_ms
    )

    if (degraded === null && wasted === null && overlapDeltaMs === null) {
      return null
    }

    const normalized: PlainObject & {
      degraded: boolean
      wasted: boolean
      overlapDeltaMs: number
      status: string
    } = {
      degraded: degraded === true,
      wasted: wasted === true,
      overlapDeltaMs: overlapDeltaMs ?? 0,
      status: 'unknown'
    }
    normalized.status = resolvePrefetchStatusTag(normalized)
    return normalized
  }

  function applyPrefetchDebugToMessage(message: AssistantMessage | null, payload: unknown = {}): PlainObject | null {
    if (!message || !payload) return null
    const prefetchDebug = extractPrefetchDebugState(payload)
    if (!prefetchDebug) return null
    message.prefetchDebug = prefetchDebug
    return prefetchDebug
  }

  function getMessage(aiMessageIndex: number): AssistantMessage | null {
    return messagesRef.value?.[aiMessageIndex] || null
  }

  function applyIntentMetaToMessage(message: AssistantMessage | null, intent: unknown): PlainObject | null {
    if (!message || !intent) return null
    const intentObject = asPlainObject(intent)

    const mergedIntent = {
      ...(message.intentMeta || {}),
      ...intentObject
    }

    message.intentMeta = mergedIntent
    if (typeof mergedIntent.queryType === 'string') message.queryType = mergedIntent.queryType
    if ('queryPlan' in mergedIntent) message.queryPlan = mergedIntent.queryPlan

    const resolvedMode = toEmbeddedIntentMode(mergedIntent.intentMode, mergedIntent.queryType)
    if (resolvedMode) {
      message.intentMode = resolvedMode
    }

    return mergedIntent
  }

  function applySSEMetaToMessage(message: AssistantMessage | null, payload: unknown): void {
    if (!message || !payload || typeof payload !== 'object' || Array.isArray(payload)) return

    const payloadObject = payload as PlainObject
    const traceId = payloadObject.trace_id || payloadObject.traceId
    const schemaVersion = payloadObject.schema_version || payloadObject.schemaVersion
    const capabilities = Array.isArray(payloadObject.capabilities) ? payloadObject.capabilities.slice() : null

    if (traceId) message.traceId = String(traceId)
    if (schemaVersion) message.schemaVersion = String(schemaVersion)
    if (capabilities) message.capabilities = capabilities.map((item) => String(item))
  }

  function dispatchRefinedResult(data: unknown, aiMessageIndex: number): void {
    const normalized = normalizeRefinedResultEvidence(data)
    const currentMsg = getMessage(aiMessageIndex)

    if (currentMsg) {
      applySSEMetaToMessage(currentMsg, data)
      if (normalized.boundary) currentMsg.boundary = normalized.boundary
      if (normalized.spatialClusters) currentMsg.spatialClusters = normalized.spatialClusters
      if (normalized.vernacularRegions.length > 0) currentMsg.vernacularRegions = normalized.vernacularRegions
      if (normalized.fuzzyRegions.length > 0) currentMsg.fuzzyRegions = normalized.fuzzyRegions
      if (normalized.stats) currentMsg.analysisStats = normalized.stats
      const modelTiming = asPlainObject(normalized.stats?.model_timing_ms)
      if (Object.keys(modelTiming).length > 0) currentMsg.modelTiming = modelTiming
      applyPrefetchDebugToMessage(currentMsg, data)
      applyIntentMetaToMessage(currentMsg, normalized.intent)
    }

    if (normalized.boundary) emit('ai-boundary', normalized.boundary)
    if (asArray(normalized.spatialClusters?.hotspots).length > 0) emit('ai-spatial-clusters', normalized.spatialClusters)
    if (normalized.vernacularRegions.length > 0) emit('ai-vernacular-regions', normalized.vernacularRegions)
    if (normalized.fuzzyRegions.length > 0) emit('ai-fuzzy-regions', normalized.fuzzyRegions)
    if (normalized.stats) emit('ai-analysis-stats', normalized.stats)
    if (normalized.intent) emit('ai-intent-meta', normalized.intent)
  }

  function dispatchMetaEvent({ type, data, aiMessageIndex, fallbackIntentMode }: DispatchMetaEventArgs): PlainObject {
    const currentMsg = getMessage(aiMessageIndex)

    if (type === 'trace' && data && typeof data === 'object') {
      if (currentMsg) {
        const tracePayload = data as PlainObject
        const traceId = tracePayload.trace_id || tracePayload.traceId || tracePayload.request_id || tracePayload.requestId
        if (traceId) currentMsg.traceId = String(traceId)
        applySSEMetaToMessage(currentMsg, tracePayload)
      }
      return {}
    }

    // 处理思考状态事件（V3 模型推理）
    if (type === 'thinking') {
      // { status: 'start'|'end', message: '...' }
      const thinkingPayload = asPlainObject(data)
      if (currentMsg) {
        if (thinkingPayload.status === 'start') {
          currentMsg.isThinking = true
          currentMsg.thinkingMessage = String(thinkingPayload.message || '正在思考...')
        } else if (thinkingPayload.status === 'end') {
          // 保持运行态直到外层流式请求真正结束，否则前端会过早停止转圈，
          // 造成“分析已结束但回答还在输出”的错位体验。
          currentMsg.isThinking = currentMsg.isStreaming !== false
          if (thinkingPayload.message) {
            currentMsg.thinkingMessage = String(thinkingPayload.message)
          }
        }
      }
      return {}
    }

    // 处理思考内容事件（V3 模型推理过程）
    if (type === 'reasoning') {
      // { content: '...' }
      const reasoningPayload = asPlainObject(data)
      if (currentMsg && reasoningPayload.content) {
        // 将思考内容存储到消息中，前端可以选择是否显示
        if (!currentMsg.reasoningContent) {
          currentMsg.reasoningContent = ''
        }
        currentMsg.reasoningContent += String(reasoningPayload.content)
      }
      return {}
    }

    if (type === 'intent_preview' && data && typeof data === 'object') {
      const previewPayload = data as PlainObject
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, previewPayload)
        currentMsg.intentPreview = {
          rawAnchor: previewPayload.rawAnchor ?? null,
          normalizedAnchor: previewPayload.normalizedAnchor ?? null,
          displayAnchor: previewPayload.displayAnchor ?? previewPayload.place_name ?? null,
          targetCategory: previewPayload.targetCategory ?? previewPayload.poi_sub_type ?? null,
          spatialRelation: previewPayload.spatialRelation ?? null,
          confidence: Number.isFinite(Number(previewPayload.confidence)) ? Number(previewPayload.confidence) : null,
          needsClarification: previewPayload.needsClarification === true,
          clarificationHint: String(previewPayload.clarificationHint || ''),
          isAbbreviation: previewPayload.isAbbreviation === true,
          parserModel: previewPayload.parserModel || previewPayload.parser_model || null,
          parserProvider: previewPayload.parserProvider || previewPayload.parser_provider || null
        }
        const intentPreview = asPlainObject(currentMsg.intentPreview)
        currentMsg.thinkingMessage = intentPreview.displayAnchor
          ? `已识别：${intentPreview.displayAnchor}${intentPreview.targetCategory ? ` · ${intentPreview.targetCategory}` : ''}`
          : (currentMsg.thinkingMessage || '已完成问题拆解')
      }
      return {}
    }

    if (type === 'stage') {
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, data)
        applyPrefetchDebugToMessage(currentMsg, data)
      }
      const stagePayload = asPlainObject(data)
      const stageName = typeof data === 'string' ? data : stagePayload.name
      const normalizedStage = String(stageName || '').trim().toLowerCase()
      if (currentMsg && normalizedStage) {
        if (normalizedStage === 'general_qa' || normalizedStage === 'smalltalk') {
          currentMsg.queryType = 'general_qa'
          currentMsg.intentMode = 'llm_chat'
        } else if (normalizedStage === 'irrelevant_input') {
          currentMsg.queryType = 'irrelevant_input'
          currentMsg.intentMode = 'out_of_scope'
        }
      }
      return { stage: stageName || '' }
    }

    if (type === 'pois' && Array.isArray(data)) {
      extractedPOIsRef.value = data
      if (currentMsg) {
        currentMsg.pois = asArray(data)
        currentMsg.intentMode = fallbackIntentMode
      }
      return {}
    }

    if (type === 'partial' && data) {
      // 流式骨架渲染：后端在聚类前先 yield 一个 convex_hull_preview 边界，
      // 前端立即渲染到地图上作为预览，让用户更早看到结果。
      const partialPayload = asPlainObject(data)
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, partialPayload)
        if (partialPayload.boundary) {
          currentMsg.previewBoundary = partialPayload.boundary
          currentMsg.previewSource = String(partialPayload.source || 'partial')
        }
      }
      if (partialPayload.boundary && typeof partialPayload.boundary === 'object' && !Array.isArray(partialPayload.boundary)) {
        emit('ai-boundary', {
          ...partialPayload.boundary,
          _preview: true,
          _source: partialPayload.source || 'partial'
        })
      }
      return {}
    }

    if (type === 'boundary' && data) {
      if (currentMsg) {
        currentMsg.boundary = data
        applySSEMetaToMessage(currentMsg, data)
      }
      emit('ai-boundary', data)
      return {}
    }

    if (type === 'spatial_clusters' && data) {
      const clusterPayload = asPlainObject(data)
      if (currentMsg) currentMsg.spatialClusters = clusterPayload
      if (currentMsg) applySSEMetaToMessage(currentMsg, clusterPayload)
      emit('ai-spatial-clusters', clusterPayload)
      return {}
    }

    if (type === 'vernacular_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.vernacularRegions = asArray(data)
      emit('ai-vernacular-regions', asArray(data))
      return {}
    }

    if (type === 'fuzzy_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.fuzzyRegions = asArray(data)
      emit('ai-fuzzy-regions', asArray(data))
      return {}
    }

    if (type === 'stats' && data && typeof data === 'object') {
      const statsPayload = data as PlainObject
      if (currentMsg) currentMsg.analysisStats = statsPayload
      if (currentMsg && statsPayload.model_timing_ms && typeof statsPayload.model_timing_ms === 'object') {
        currentMsg.modelTiming = asPlainObject(statsPayload.model_timing_ms)
      }
      if (currentMsg) applySSEMetaToMessage(currentMsg, statsPayload)
      if (currentMsg) applyPrefetchDebugToMessage(currentMsg, statsPayload)
      emit('ai-analysis-stats', statsPayload)

      const statsIntent = normalizeRefinedResultEvidence({
        results: { stats: statsPayload }
      })?.intent
      const resolvedIntent = applyIntentMetaToMessage(currentMsg, statsIntent)
      if (resolvedIntent) {
        emit('ai-intent-meta', resolvedIntent)
      }
      return {}
    }

    if (type === 'refined_result' && data && typeof data === 'object') {
      dispatchRefinedResult(data, aiMessageIndex)
      return {}
    }

    if (type === 'progress' && data) {
      const progressPayload = asPlainObject(data)
      if (currentMsg) {
        currentMsg.progress = progressPayload.progress
        applySSEMetaToMessage(currentMsg, progressPayload)
      }
      return {}
    }

    if (type === 'schema_error' && data) {
      const schemaErrorPayload = asPlainObject(data)
      if (currentMsg) {
        currentMsg.schemaWarning = {
          event: schemaErrorPayload.event,
          errors: Array.isArray(schemaErrorPayload.errors) ? schemaErrorPayload.errors.slice(0, 3) : [],
          traceId: schemaErrorPayload.trace_id || schemaErrorPayload.traceId || null
        }
        applySSEMetaToMessage(currentMsg, schemaErrorPayload)
      }
      return {}
    }

    return {}
  }

  return {
    dispatchMetaEvent
  }
}
