/**
 * Evidence Atom 类型定义。
 * 阶段 4：每个 Atom 对应一次最小粒度的工具调用。
 */

export type EvidenceAtom =
  | 'anchor.resolved'
  | 'anchor.secondary_resolved'
  | 'poi.nearby_list'
  | 'poi.nearest_station'
  | 'area.category_histogram'
  | 'area.representative_samples'
  | 'area.hotspots'
  | 'area.ring_distribution'
  | 'area.competition_density'
  | 'area.aoi_context'
  | 'area.landuse_context'
  | 'area.focused_samples'
  | 'area.region_encoding'
  | 'poi.profile_encoding'
  | 'compare.pairs'
  | 'web.multi_search'
  | 'web.tavily'
  | 'web.entity_alignment'

/**
 * 每个 Atom 对应的工具调用参数
 */
export interface AtomExecutionSpec {
  atom: EvidenceAtom
  skill: string
  action: string
  payloadTemplate: Record<string, unknown>
  /** 依赖的前置 atom（必须先完成） */
  dependsOn: EvidenceAtom[]
  /** 是否可以和无依赖的其他 atom 并行 */
  parallelizable: boolean
}
