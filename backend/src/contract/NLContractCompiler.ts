/**
 * NL-Contract 编译器。
 * 阶段 2：从 DeterministicIntent 规则推导契约，覆盖 95% 场景无需 LLM。
 */
import type { DeterministicIntent } from '../chat/types.js'
import type { NLContract, ContractDepth, ContractScope, WebSearchStrategy } from './types.js'

export class NLContractCompiler {
  /**
   * 规则编译：从已解析的意图直接推导契约，无需 LLM。
   */
  compileFromIntent(intent: DeterministicIntent, rawQuery: string): NLContract {
    const depth = this.inferDepth(intent, rawQuery)
    const scope = this.inferScope(intent)
    const forbiddenBlocks = this.inferForbiddenBlocks(intent, rawQuery, depth)
    const { needsWebEvidence, webSearchStrategy } = this.inferWebEvidence(intent)
    const narrative = this.buildNarrative(intent, rawQuery, forbiddenBlocks, needsWebEvidence)

    return {
      narrative,
      meta: {
        scope,
        depth,
        forbiddenBlocks,
        estimatedAtomCount: this.estimateAtomCount(depth, needsWebEvidence),
        trackingId: `contract_${Date.now()}`,
        needsWebEvidence,
        webSearchStrategy,
      },
    }
  }

  private inferDepth(intent: DeterministicIntent, rawQuery: string): ContractDepth {
    if (['nearby_poi', 'nearest_station'].includes(intent.queryType)) {
      return 'lookup'
    }
    if (intent.queryType === 'area_overview') {
      // 仅问"是什么" → descriptive；问"分布/结构" → structural；问"值不值得/适合" → prescriptive
      if (/适合|值不值得|行不行|开店|投资|竞争/u.test(rawQuery)) return 'prescriptive'
      if (/分布|结构|热点|聚集|密度/u.test(rawQuery)) return 'structural'
      return 'descriptive'
    }
    if (intent.queryType === 'compare_places') return 'structural'
    if (intent.queryType === 'similar_regions') return 'structural'
    return 'descriptive'
  }

  private inferScope(intent: DeterministicIntent): ContractScope {
    if (intent.anchorSource === 'map_view') return 'viewport'
    if (intent.anchorSource === 'user_location') return 'user_location'
    return 'place'
  }

  /**
   * 判断是否需要联网搜索补充证据
   * 优先使用 LLM 在意图识别阶段的判断（intent.needsWebSearch），
   * 同时加入确定性兜底规则：当 rawQuery 包含评分/高分/推荐/口碑等关键词时，
   * 即使 LLM 漏判也强制触发 web search
   * 策略：hybrid（Multi Search 主力 + Tavily 后备）
   */
  private inferWebEvidence(intent: DeterministicIntent): { needsWebEvidence: boolean, webSearchStrategy: WebSearchStrategy } {
    const rawQuery = intent.rawQuery || ''
    const webTriggerRe = /高分|评分|评价|口碑|推荐|排名|好不好|体验|营业|价格|人均|新开|最新|动态|趋势|规划|好吃|特色|必吃|必去|网红|人气/u
    const deterministicTrigger = webTriggerRe.test(rawQuery)

    if (!intent.needsWebSearch && !deterministicTrigger) {
      return { needsWebEvidence: false, webSearchStrategy: 'none' }
    }
    return { needsWebEvidence: true, webSearchStrategy: 'hybrid' }
  }

  private inferForbiddenBlocks(
    intent: DeterministicIntent,
    rawQuery: string,
    depth: ContractDepth,
  ): string[] {
    const forbidden: string[] = []
    // 用户没问"机会/投资"，就禁止输出
    if (!/机会|投资|商机|前景/u.test(rawQuery)) forbidden.push('投资机会')
    if (!/异常|风险|问题/u.test(rawQuery)) forbidden.push('异常点')
    if (!/开店|选址|适合/u.test(rawQuery)) forbidden.push('开店建议')
    if (!/发展|潜力|趋势/u.test(rawQuery)) forbidden.push('发展潜力')
    // lookup 深度禁止所有分析性输出
    if (depth === 'lookup') {
      forbidden.push('业态分析', '片区总结', '热点分析')
    }
    return [...new Set(forbidden)]
  }

  private buildNarrative(
    _intent: DeterministicIntent,
    rawQuery: string,
    _forbiddenBlocks: string[],
    _needsWebEvidence: boolean,
  ): string {
    return `围绕用户问题「${rawQuery}」组织基于证据的回答。`
  }

  private estimateAtomCount(depth: ContractDepth, needsWebEvidence: boolean): number {
    let base = 3
    switch (depth) {
      case 'lookup': base = 2; break
      case 'descriptive': base = 3; break
      case 'structural': base = 6; break
      case 'prescriptive': base = 7; break
    }
    // 联网搜索增加 2-3 个 atom (multi_search + tavily + entity_alignment)
    return needsWebEvidence ? base + 3 : base
  }
}
