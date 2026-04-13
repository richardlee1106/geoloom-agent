/**
 * 澄清拦截器。
 * 阶段 3：在 resolveIntent() 前执行，检查空间上下文是否足够。
 */

export interface ClarificationResult {
  needsClarification: boolean
  reason: string | null
  param: string | null
  /** 如果不需要 Clarification，返回推导出的 scope 信息 */
  resolvedScope: {
    kind: 'viewport' | 'boundary' | 'drawn_region' | 'user_location' | 'ambiguous'
    hasExplicitBounds: boolean
  } | null
}

export class IntentAlignmentGuard {
  /**
   * 有条件的严格：
   * - 有 viewport/boundary/region → 通过
   * - 只有 user_location 没有 radius 且问"附近" → 弹窗
   * - 完全没有空间上下文 → 弹窗
   */
  evaluate(input: {
    rawQuery: string
    hasViewport: boolean
    hasBoundary: boolean
    hasDrawnRegion: boolean
    hasUserLocation: boolean
    hasExplicitRadius: boolean
  }): ClarificationResult {
    // 有明确边界 → 直接通过
    if (input.hasDrawnRegion) {
      return { needsClarification: false, reason: null, param: null, resolvedScope: { kind: 'drawn_region', hasExplicitBounds: true } }
    }
    if (input.hasBoundary) {
      return { needsClarification: false, reason: null, param: null, resolvedScope: { kind: 'boundary', hasExplicitBounds: true } }
    }
    if (input.hasViewport) {
      return { needsClarification: false, reason: null, param: null, resolvedScope: { kind: 'viewport', hasExplicitBounds: true } }
    }

    // 有位置但问"附近"类问题且无 radius
    const isNearbyQuery = /附近|周边|旁边|身边|这里/u.test(input.rawQuery)
    if (input.hasUserLocation && isNearbyQuery && !input.hasExplicitRadius) {
      return {
        needsClarification: true,
        reason: '需要确认"附近"的具体范围，例如500米还是骑行10分钟。',
        param: 'search_radius',
        resolvedScope: null,
      }
    }
    if (input.hasUserLocation) {
      return { needsClarification: false, reason: null, param: null, resolvedScope: { kind: 'user_location', hasExplicitBounds: false } }
    }

    // 完全没有空间上下文 — 检测是否提到了具体地点名称
    const isExplicitPlaceQuery = /[\u4e00-\u9fa5]{2,}(?:\u9644\u8fd1|\u5468\u8fb9|\u65c1\u8fb9|\u6700\u8fd1|\u5730\u94c1\u7ad9)|\u6bd4\u8f83|\u5728[\u4e00-\u9fa5]{2,}|\u53bb[\u4e00-\u9fa5]{2,}/.test(input.rawQuery)
    if (isExplicitPlaceQuery) {
      return { needsClarification: false, reason: null, param: null, resolvedScope: { kind: 'ambiguous', hasExplicitBounds: false } }
    }

    return {
      needsClarification: true,
      reason: '当前没有空间上下文。请在地图上选中一个区域，或者告诉我一个明确地点。',
      param: 'spatial_context',
      resolvedScope: null,
    }
  }
}
