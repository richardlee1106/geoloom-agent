/**
 * 确定性证据执行引擎。
 * 阶段 5：按 dependsOn 拓扑排序，分 wave 并行执行，零 LLM 调用。
 */
import type { AtomExecutionSpec, EvidenceAtom } from './atoms.js'
import type { ToolExecutionTrace, DeterministicIntent } from '../chat/types.js'
import type { AgentTurnState } from '../agent/types.js'
import type { SSEWriter } from '../chat/SSEWriter.js'
import { pickRepresentativeAnchorName } from './areaInsight/representativeAnchorPriority.js'
export interface DeterministicRuntimeInput {
  specs: AtomExecutionSpec[]
  intent: DeterministicIntent
  state: AgentTurnState
  writer: SSEWriter
  /** 执行单个工具调用的回调，复用 GeoLoomAgent.executeToolCall 逻辑（context 由闭包捕获） */
  executeToolCall: (call: {
    id: string
    name: string
    arguments: Record<string, unknown>
  }) => Promise<{
    content: unknown
    trace: ToolExecutionTrace
  }>
}

export class DeterministicEvidenceRuntime {
  /** 各 atom 的执行结果缓存，供后续 atom 注入前序数据 */
  private atomResults = new Map<EvidenceAtom, unknown>()

  /**
   * 按拓扑顺序分 wave 执行所有 atom spec。
   * 返回所有工具调用 trace。
   */
  async execute(input: DeterministicRuntimeInput): Promise<ToolExecutionTrace[]> {
    this.atomResults.clear()
    const waves = this.buildWaves(input.specs)
    const traces: ToolExecutionTrace[] = []

    for (const wave of waves) {
      await input.writer.stage('tool_run')
      await input.writer.thinking({
        status: 'start',
        message: `正在并行执行 ${wave.map(s => s.atom).join(', ')}...`,
      })

      const waveResults = await Promise.all(
        wave.map(spec => this.executeAtom(spec, input, traces.length)),
      )
      traces.push(...waveResults)
    }

    return traces
  }

  /**
   * 按 dependsOn 拓扑排序，将无依赖的 spec 放入同一 wave。
   */
  buildWaves(specs: AtomExecutionSpec[]): AtomExecutionSpec[][] {
    const waves: AtomExecutionSpec[][] = []
    const resolved = new Set<EvidenceAtom>()
    let remaining = [...specs]
    // 仅检查存在于当前 specs 集合中的依赖（跳过不在 plan 中的可选依赖）
    const specAtoms = new Set(specs.map(s => s.atom))

    // 最多迭代 specs.length 次，防止循环依赖
    for (let i = 0; i < specs.length && remaining.length > 0; i++) {
      const wave: AtomExecutionSpec[] = []
      const nextRemaining: AtomExecutionSpec[] = []

      for (const spec of remaining) {
        const depsReady = spec.dependsOn
          .filter(dep => specAtoms.has(dep)) // 仅检查 plan 内的依赖
          .every(dep => resolved.has(dep))
        if (depsReady) {
          wave.push(spec)
        } else {
          nextRemaining.push(spec)
        }
      }

      if (wave.length === 0) {
        // 剩余 spec 有循环依赖，全部强制放入最后一波
        waves.push(nextRemaining)
        break
      }

      waves.push(wave)
      for (const spec of wave) {
        resolved.add(spec.atom)
      }
      remaining = nextRemaining
    }

    return waves
  }

  private async executeAtom(
    spec: AtomExecutionSpec,
    input: DeterministicRuntimeInput,
    traceOffset: number,
  ): Promise<ToolExecutionTrace> {
    const callId = `fast_${spec.atom}_${traceOffset + 1}`
    const payload: Record<string, unknown> = { ...spec.payloadTemplate }

    // 为 resolve_anchor 注入 place_name
    if (spec.action === 'resolve_anchor') {
      const role = String(payload.role || 'primary')
      if (role === 'primary' && input.intent.placeName) {
        payload.place_name = input.intent.placeName
      } else if (role === 'secondary' && input.intent.secondaryPlaceName) {
        payload.place_name = input.intent.secondaryPlaceName
      }
    }

    // 为 execute_spatial_sql 注入 category_key
    // 注：category_main/category_sub 通过 intent 对象直接传入 buildCategoryFilters，无需写入 payload
    if (spec.action === 'execute_spatial_sql' && input.intent.categoryKey) {
      if (!payload.category_key) {
        payload.category_key = input.intent.categoryKey
      }
    }

    // 为 web search 注入查询词
    if (spec.skill === 'multi_search_engine' || spec.skill === 'tavily_search') {
      const existingQueries = Array.isArray(payload.queries)
        ? payload.queries.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      if (!payload.query && existingQueries.length === 0) {
        const candidateReputationQueries = input.intent.toolIntent === 'candidate_reputation'
          ? this.buildCandidateReputationQueries({
              searchIntentHint: input.intent.searchIntentHint,
              nearbyPoiData: this.atomResults.get('poi.nearby_list'),
            })
          : []
        if (candidateReputationQueries.length > 0) {
          payload.queries = candidateReputationQueries
          payload.query = candidateReputationQueries[0]
        } else {
          const anchor = input.intent.placeName || ''
          const rawQ = input.intent.rawQuery || ''
          const representativeAnchor = pickRepresentativeAnchorName({
            rawAnchorName: anchor,
            aoiContext: this.extractRows(this.atomResults.get('area.aoi_context')),
            representativeItems: this.extractRows(this.atomResults.get('area.representative_samples')),
            viewportContext: input.intent.viewportContext,
          })
          // 过滤掉无意义的占位 anchor（如"当前区域"、"我的位置"等），否则搜索效果极差
          const genericAnchors = /^(当前区域|我的位置|这附近|附近|当前位置|这里|这边|那附近|周围)$/u
          const usefulAnchor = anchor && !genericAnchors.test(anchor) && !rawQ.includes(anchor) ? anchor : ''
          const searchAnchor = representativeAnchor && !rawQ.includes(representativeAnchor)
            ? representativeAnchor
            : usefulAnchor
          const baseQuery = searchAnchor ? `${searchAnchor} ${rawQ}` : rawQ
          payload.query = this.mergeSearchIntent(baseQuery, input.intent.searchIntentHint)
        }
      } else if (existingQueries.length > 0 && !payload.query) {
        payload.query = existingQueries[0]
      }
    }

    // 为 entity_alignment 注入前序 web 搜索结果和本地 POI 数据
    if (spec.atom === 'web.entity_alignment') {
      const multiData = this.atomResults.get('web.multi_search')
      const tavilyData = this.atomResults.get('web.tavily')
      const multiItems = this.extractWebResults(multiData, spec.skill)
      const tavilyItems = this.extractWebResults(tavilyData, spec.skill)
      // 按 URL 去重，优先保留有 snippet 的条目
      const seenUrls = new Set<string>()
      const allWebItems: unknown[] = []
      for (const item of [...tavilyItems, ...multiItems]) {
        const d = item as Record<string, unknown>
        const url = String(d.url || '')
        if (url && seenUrls.has(url)) continue
        if (url) seenUrls.add(url)
        allWebItems.push(item)
      }
      const poiData = this.atomResults.get('poi.nearby_list') || this.atomResults.get('area.representative_samples')
      payload.web_results = allWebItems
      payload.local_pois = this.extractLocalPois(poiData)
      // 诊断日志：确认注入数据量
      console.log(`[EntityAlignment] 注入: web_results=${allWebItems.length}, local_pois=${(payload.local_pois as unknown[]).length}, multiData=${!!multiData}, tavilyData=${!!tavilyData}, poiData=${!!poiData}`)
      if (allWebItems.length === 0) {
        console.log(`[EntityAlignment] multiItems=${multiItems.length}, tavilyItems=${tavilyItems.length}`)
        if (multiData) console.log(`[EntityAlignment] multiData keys:`, Object.keys(multiData as Record<string, unknown>))
        if (tavilyData) console.log(`[EntityAlignment] tavilyData keys:`, Object.keys(tavilyData as Record<string, unknown>))
      }
      if ((payload.local_pois as unknown[]).length === 0 && poiData) {
        console.log(`[EntityAlignment] poiData keys:`, Object.keys(poiData as Record<string, unknown>))
      }
    }

    // 检测 web search skill 并发送事件
    const isWebSearch = spec.skill === 'multi_search_engine' || spec.skill === 'tavily_search'
    if (isWebSearch) {
      const query = Array.isArray(payload.queries)
        ? payload.queries.map((item) => String(item || '').trim()).filter(Boolean).join(' | ')
        : String(payload.query || '').trim()
      await input.writer.webSearch({
        status: 'start',
        query: query || undefined,
        source: spec.skill === 'multi_search_engine' ? 'multi_search' : 'tavily',
      })
    }

    const result = await input.executeToolCall({
      id: callId,
      name: spec.skill,
      arguments: { action: spec.action, payload },
    })

    // 缓存执行结果，供后续 atom 使用
    if (result.trace.status === 'done' && result.trace.result != null) {
      this.atomResults.set(spec.atom, result.trace.result)
    }

    // web search 完成后发送完成事件
    if (isWebSearch && result.trace.status === 'done') {
      const resultItems = this.extractWebResults(result.trace.result, spec.skill)
      const pagesRead = resultItems.length
      const resultData = result.trace.result as Record<string, unknown> | undefined
      const answerPreview = this.extractWebAnswerPreview(resultData)
      await input.writer.webSearch({
        status: 'done',
        source: spec.skill === 'multi_search_engine' ? 'multi_search' : 'tavily',
        pages_read: pagesRead,
        result_count: resultItems.length,
        sample_results: resultItems.slice(0, 3),
        answer_preview: answerPreview || undefined,
        message: resultItems.length > 0 ? undefined : '未命中稳定的联网结果',
      })
    } else if (isWebSearch && result.trace.status === 'error') {
      await input.writer.webSearch({
        status: 'error',
        source: spec.skill === 'multi_search_engine' ? 'multi_search' : 'tavily',
        message: result.trace.error || '联网搜索失败',
      })
    }

    if (spec.atom === 'web.entity_alignment' && result.trace.status === 'done') {
      const alignmentData = result.trace.result as {
        ranked_results?: Array<Record<string, unknown>>
        alignment_summary?: Record<string, unknown>
      } | undefined
      const summary = alignmentData?.alignment_summary || {}
      const rankedResults = Array.isArray(alignmentData?.ranked_results) ? alignmentData!.ranked_results! : []
      await input.writer.entityAlignment({
        status: 'done',
        ...summary,
        sample_matches: rankedResults.slice(0, 5).map((item) => {
          const localPoi = item.localPoi as Record<string, unknown> | undefined
          const webItem = item.webItem as Record<string, unknown> | undefined
          return {
            name: String(item.name || localPoi?.name || webItem?.title || ''),
            verification: String(item.verification || ''),
            fusion_score: Number(item.fusionScore || 0),
            distance_m: item.distance_m ?? localPoi?.distance_m ?? null,
            local_name: String(localPoi?.name || ''),
            web_title: String(webItem?.title || ''),
            web_source: String(webItem?.source || ''),
          }
        }),
        message: rankedResults.length > 0 ? undefined : '没有形成稳定的实体对齐结果',
      })
    }

    return result.trace
  }

  /** 从 web search 结果中提取搜索条目 */
  private extractWebResults(data: unknown, skillName: string): unknown[] {
    if (!data || typeof data !== 'object') return []
    const d = data as Record<string, unknown>
    const inner = (d.data && typeof d.data === 'object') ? d.data as Record<string, unknown> : d
    // MultiSearchEngineSkill 返回 { merged: [...] }
    if (Array.isArray(inner.merged)) {
      return inner.merged.map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        snippet: String(item.snippet || ''),
        url: String(item.url || ''),
        source: 'multi_search',
      }))
    }
    // TavilySearchSkill 返回 { results: [...] }
    if (Array.isArray(inner.results)) {
      return inner.results.map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        snippet: String(item.content || item.snippet || ''),
        url: String(item.url || ''),
        source: 'tavily',
      }))
    }
    return []
  }

  private extractWebAnswerPreview(data: unknown): string {
    if (!data || typeof data !== 'object') return ''
    const d = data as Record<string, unknown>
    const inner = (d.data && typeof d.data === 'object') ? d.data as Record<string, unknown> : d
    return String(inner.answer || inner.summary || '').trim()
  }

  /** 从本地 POI 结果中提取 POI 列表 */
  private extractLocalPois(data: unknown): unknown[] {
    if (!data || typeof data !== 'object') return []
    const d = data as Record<string, unknown>
    // atomResults 存的是完整 trace.result = { ok, data, meta }，需要先解包 data
    const inner = (d.data && typeof d.data === 'object') ? d.data as Record<string, unknown> : d
    // PostGIS 返回 { rows: [...] }
    if (Array.isArray(inner.rows)) {
      return inner.rows.map((row: Record<string, unknown>) => ({
        id: row.id || row.poi_id || null,
        name: String(row.name || row.poi_name || ''),
        category: row.category || row.category_sub || null,
        categoryMain: row.category_main || null,
        categorySub: row.category_sub || null,
        longitude: row.longitude || row.lon || undefined,
        latitude: row.latitude || row.lat || undefined,
        distance_m: row.distance_m || row.dist_m || null,
        score: row.score || null,
      }))
    }
    return []
  }

  private extractRows(data: unknown): Record<string, unknown>[] {
    if (!data || typeof data !== 'object') return []
    const outer = data as Record<string, unknown>
    const inner = (outer.data && typeof outer.data === 'object') ? outer.data as Record<string, unknown> : outer
    return Array.isArray(inner.rows)
      ? inner.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      : []
  }

  private buildCandidateReputationQueries(input: {
    searchIntentHint?: string | null
    nearbyPoiData: unknown
  }) {
    const intentHint = String(input.searchIntentHint || '').trim() || '评分 推荐'
    const nearbyPois = this.extractLocalPois(input.nearbyPoiData)
      .map((poi) => poi as Record<string, unknown>)
      .map((poi) => String(poi.name || '').trim())
      .filter(Boolean)
    const uniqueNames = [...new Set(nearbyPois)]
      .filter((name) => name.length >= 2)
      .slice(0, 3)

    return uniqueNames.map((name) => this.mergeSearchIntent(name, intentHint))
  }

  private mergeSearchIntent(baseQuery: string, searchIntentHint?: string | null) {
    const base = String(baseQuery || '').trim()
    const hint = String(searchIntentHint || '').trim()
    if (!base) return hint
    if (!hint) return base

    const needsHint = hint
      .split(/\s+/u)
      .filter(Boolean)
      .some((token) => !base.includes(token))

    return needsHint ? `${base} ${hint}` : base
  }
}
