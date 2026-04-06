export function useAiStreamDispatcher({
  messagesRef,
  extractedPOIsRef,
  emit,
  normalizeRefinedResultEvidence,
  toEmbeddedIntentMode
}) {
  function toBooleanOrNull(value) {
    if (value === true) return true
    if (value === false) return false
    return null
  }

  function toFiniteNumberOrNull(value) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  function resolvePrefetchStatusTag(prefetchDebug = {}) {
    if (prefetchDebug.degraded === true) return 'degraded'
    if (prefetchDebug.wasted === true) return 'wasted'
    if (prefetchDebug.degraded === false || prefetchDebug.wasted === false) return 'effective'
    return 'unknown'
  }

  function extractPrefetchDebugState(payload = {}) {
    const root = payload && typeof payload === 'object' ? payload : {}
    const statsSource = (
      (root.results && typeof root.results === 'object' ? root.results.stats : null)
      || (root.stats && typeof root.stats === 'object' ? root.stats : null)
      || null
    )
    const diagnosticsSource = root.diagnostics && typeof root.diagnostics === 'object'
      ? root.diagnostics
      : null
    const prefetchDiag = diagnosticsSource?.prefetch && typeof diagnosticsSource.prefetch === 'object'
      ? diagnosticsSource.prefetch
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

    const normalized = {
      degraded: degraded === true,
      wasted: wasted === true,
      overlapDeltaMs: overlapDeltaMs ?? 0
    }
    normalized.status = resolvePrefetchStatusTag(normalized)
    return normalized
  }

  function applyPrefetchDebugToMessage(message, payload = {}) {
    if (!message || !payload) return null
    const prefetchDebug = extractPrefetchDebugState(payload)
    if (!prefetchDebug) return null
    message.prefetchDebug = prefetchDebug
    return prefetchDebug
  }

  function getMessage(aiMessageIndex) {
    return messagesRef.value?.[aiMessageIndex] || null
  }

  function applyIntentMetaToMessage(message, intent) {
    if (!message || !intent) return null

    const mergedIntent = {
      ...(message.intentMeta || {}),
      ...intent
    }

    message.intentMeta = mergedIntent
    if (mergedIntent.queryType) message.queryType = mergedIntent.queryType
    if (mergedIntent.queryPlan) message.queryPlan = mergedIntent.queryPlan

    const resolvedMode = toEmbeddedIntentMode(mergedIntent.intentMode, mergedIntent.queryType)
    if (resolvedMode) {
      message.intentMode = resolvedMode
    }

    return mergedIntent
  }

  function applySSEMetaToMessage(message, payload) {
    if (!message || !payload || typeof payload !== 'object' || Array.isArray(payload)) return

    const traceId = payload.trace_id || payload.traceId
    const schemaVersion = payload.schema_version || payload.schemaVersion
    const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.slice() : null

    if (traceId) message.traceId = String(traceId)
    if (schemaVersion) message.schemaVersion = String(schemaVersion)
    if (capabilities) message.capabilities = capabilities
  }

  function dispatchRefinedResult(data, aiMessageIndex) {
    const normalized = normalizeRefinedResultEvidence(data)
    const currentMsg = getMessage(aiMessageIndex)

    if (currentMsg) {
      applySSEMetaToMessage(currentMsg, data)
      if (normalized.boundary) currentMsg.boundary = normalized.boundary
      if (normalized.spatialClusters) currentMsg.spatialClusters = normalized.spatialClusters
      if (normalized.vernacularRegions.length > 0) currentMsg.vernacularRegions = normalized.vernacularRegions
      if (normalized.fuzzyRegions.length > 0) currentMsg.fuzzyRegions = normalized.fuzzyRegions
      if (normalized.stats) currentMsg.analysisStats = normalized.stats
      if (normalized.stats?.model_timing_ms) currentMsg.modelTiming = normalized.stats.model_timing_ms
      applyPrefetchDebugToMessage(currentMsg, data)
      applyIntentMetaToMessage(currentMsg, normalized.intent)
    }

    if (normalized.boundary) emit('ai-boundary', normalized.boundary)
    if (normalized.spatialClusters?.hotspots?.length) emit('ai-spatial-clusters', normalized.spatialClusters)
    if (normalized.vernacularRegions.length > 0) emit('ai-vernacular-regions', normalized.vernacularRegions)
    if (normalized.fuzzyRegions.length > 0) emit('ai-fuzzy-regions', normalized.fuzzyRegions)
    if (normalized.stats) emit('ai-analysis-stats', normalized.stats)
    if (normalized.intent) emit('ai-intent-meta', normalized.intent)
  }

  function dispatchMetaEvent({ type, data, aiMessageIndex, fallbackIntentMode }) {
    const currentMsg = getMessage(aiMessageIndex)

    if (type === 'trace' && data && typeof data === 'object') {
      if (currentMsg) {
        const traceId = data.trace_id || data.traceId || data.request_id || data.requestId
        if (traceId) currentMsg.traceId = String(traceId)
      }
      return {}
    }

    // 处理思考状态事件（V3 模型推理）
    if (type === 'thinking') {
      // { status: 'start'|'end', message: '...' }
      if (currentMsg) {
        if (data?.status === 'start') {
          currentMsg.isThinking = true
          currentMsg.thinkingMessage = data.message || '正在思考...'
        } else if (data?.status === 'end') {
          currentMsg.isThinking = false
          if (data.message) {
            currentMsg.thinkingMessage = data.message
          }
        }
      }
      return {}
    }

    // 处理思考内容事件（V3 模型推理过程）
    if (type === 'reasoning') {
      // { content: '...' }
      if (currentMsg && data?.content) {
        // 将思考内容存储到消息中，前端可以选择是否显示
        if (!currentMsg.reasoningContent) {
          currentMsg.reasoningContent = ''
        }
        currentMsg.reasoningContent += data.content
      }
      return {}
    }

    if (type === 'intent_preview' && data && typeof data === 'object') {
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, data)
        currentMsg.intentPreview = {
          rawAnchor: data.rawAnchor ?? null,
          normalizedAnchor: data.normalizedAnchor ?? null,
          displayAnchor: data.displayAnchor ?? data.place_name ?? null,
          targetCategory: data.targetCategory ?? data.poi_sub_type ?? null,
          spatialRelation: data.spatialRelation ?? null,
          confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
          needsClarification: data.needsClarification === true,
          clarificationHint: data.clarificationHint || '',
          isAbbreviation: data.isAbbreviation === true,
          parserModel: data.parserModel || data.parser_model || null,
          parserProvider: data.parserProvider || data.parser_provider || null
        }
        currentMsg.thinkingMessage = currentMsg.intentPreview?.displayAnchor
          ? `已识别：${currentMsg.intentPreview.displayAnchor}${currentMsg.intentPreview.targetCategory ? ` · ${currentMsg.intentPreview.targetCategory}` : ''}`
          : (currentMsg.thinkingMessage || '已完成问题拆解')
      }
      return {}
    }

    if (type === 'stage') {
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, data)
        applyPrefetchDebugToMessage(currentMsg, data)
      }
      const stageName = typeof data === 'string' ? data : data?.name
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
        currentMsg.pois = data
        currentMsg.intentMode = fallbackIntentMode
      }
      return {}
    }

    if (type === 'partial' && data) {
      // 流式骨架渲染：后端在聚类前先 yield 一个 convex_hull_preview 边界，
      // 前端立即渲染到地图上作为预览，让用户更早看到结果。
      if (currentMsg) {
        applySSEMetaToMessage(currentMsg, data)
        if (data.boundary) {
          currentMsg.previewBoundary = data.boundary
          currentMsg.previewSource = data.source || 'partial'
        }
      }
      if (data.boundary) {
        emit('ai-boundary', {
          ...data.boundary,
          _preview: true,
          _source: data.source || 'partial'
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
      if (currentMsg) currentMsg.spatialClusters = data
      if (currentMsg) applySSEMetaToMessage(currentMsg, data)
      emit('ai-spatial-clusters', data)
      return {}
    }

    if (type === 'vernacular_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.vernacularRegions = data
      emit('ai-vernacular-regions', data)
      return {}
    }

    if (type === 'fuzzy_regions' && Array.isArray(data)) {
      if (currentMsg) currentMsg.fuzzyRegions = data
      emit('ai-fuzzy-regions', data)
      return {}
    }

    if (type === 'stats' && data && typeof data === 'object') {
      if (currentMsg) currentMsg.analysisStats = data
      if (currentMsg && data.model_timing_ms && typeof data.model_timing_ms === 'object') {
        currentMsg.modelTiming = data.model_timing_ms
      }
      if (currentMsg) applySSEMetaToMessage(currentMsg, data)
      if (currentMsg) applyPrefetchDebugToMessage(currentMsg, data)
      emit('ai-analysis-stats', data)

      const statsIntent = normalizeRefinedResultEvidence({
        results: { stats: data }
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
      if (currentMsg) {
        currentMsg.progress = data.progress
        applySSEMetaToMessage(currentMsg, data)
      }
      return {}
    }

    if (type === 'schema_error' && data) {
      if (currentMsg) {
        currentMsg.schemaWarning = {
          event: data.event,
          errors: Array.isArray(data.errors) ? data.errors.slice(0, 3) : [],
          traceId: data.trace_id || data.traceId || null
        }
        applySSEMetaToMessage(currentMsg, data)
      }
      return {}
    }

    return {}
  }

  return {
    dispatchMetaEvent
  }
}
