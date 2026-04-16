/**
 * NL-Contract 类型系统。
 * 阶段 2：为后续阶段提供类型基础，不改变执行链路。
 */

export type ContractScope = 'viewport' | 'place' | 'user_location' | 'drawn_region'
export type ContractDepth = 'lookup' | 'descriptive' | 'structural' | 'prescriptive'
export type WebSearchStrategy = 'none' | 'tavily' | 'multi_search' | 'hybrid' | 'entity_alignment_only' | 'poi_discovery' | 'hybrid_with_discovery'

export interface NLContractMeta {
  scope: ContractScope
  depth: ContractDepth
  forbiddenBlocks: string[]
  estimatedAtomCount: number
  trackingId: string
  /** 是否需要联网搜索补充证据 */
  needsWebEvidence: boolean
  /** 搜索策略：none=不搜索，tavily/multi_search=单源，hybrid=多源 */
  webSearchStrategy: WebSearchStrategy
}

export interface NLContract {
  /** 人类 / LLM 可读的自然语言目标（保真透传） */
  narrative: string
  /** 机器可读的薄壳（用于可观测性、断言、分流） */
  meta: NLContractMeta
}
