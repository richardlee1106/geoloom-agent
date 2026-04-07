type PlainObject = Record<string, unknown>

export interface AiBoundaryMeta extends PlainObject {
  anchorName?: string
  nicheType?: string
  nicheConfidence?: number | null
  boundaryConfidence?: number | null
  confidenceModel?: string | null
  signalModel?: string | null
  encoderPredictedCount?: number | null
  encoderHighConfidenceCount?: number | null
  vectorConstraintSource?: string | null
  waterPenalty?: number | null
  waterOverlapRatio?: number | null
  reasonTypes?: string[]
  topLanduseLabels?: string[]
}

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

export function toFiniteBoundaryConfidence(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

export function confidenceBucket(score: unknown): 'high' | 'medium' | 'low' | 'unknown' {
  const value = toFiniteBoundaryConfidence(score)
  if (value === null) return 'unknown'
  if (value >= 0.7) return 'high'
  if (value >= 0.4) return 'medium'
  return 'low'
}

export function formatLegendPercent(value: unknown): string {
  const score = toFiniteBoundaryConfidence(value)
  if (score === null) return '--'
  return `${Math.round(score * 100)}%`
}

export function nicheLabel(nicheType: unknown): string {
  const normalized = String(nicheType || '').trim().toLowerCase()
  const labels: Record<string, string> = {
    ecology: '生态',
    commerce: '商业',
    education: '科教',
    mixed: '复合'
  }
  return labels[normalized] || normalized || '复合'
}

function toFiniteCount(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function buildAiBoundaryMeta(entity: unknown = null, extra: PlainObject = {}): AiBoundaryMeta {
  if (!entity || typeof entity !== 'object') {
    return { ...(extra && typeof extra === 'object' ? extra : {}) }
  }

  const entityObject = asPlainObject(entity)
  const semanticAnchor = asPlainObject(entityObject.semantic_anchor || entityObject.semanticAnchor)
  const nicheProfile = asPlainObject(entityObject.niche_profile || entityObject.nicheProfile)
  const semanticReasoning = asPlainObject(entityObject.semantic_reasoning || entityObject.semanticReasoning)
  const confidenceExplain = asPlainObject(entityObject.confidence_explain || entityObject.confidenceExplain)
  const boundaryQuality = asPlainObject(entityObject.boundary_quality || entityObject.boundaryQuality)
  const landuseSemantic = asPlainObject(entityObject.landuse_semantic || entityObject.landuseSemantic)
  const signalSummary = asPlainObject(entityObject.signal_summary || entityObject.signalSummary)

  const reasonTypes = Array.isArray(semanticReasoning.evidence)
    ? [...new Set(
        semanticReasoning.evidence
          .map((item) => String(asPlainObject(item).type || '').trim())
          .filter(Boolean)
      )]
    : []

  const topLabelCandidates = landuseSemantic.top_labels || landuseSemantic.topLabels || []
  const topLanduseLabels = Array.isArray(topLabelCandidates)
    ? topLabelCandidates
        .map((item) => String(asPlainObject(item).label || item || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : []

  return {
    ...extra,
    anchorName: String(semanticAnchor.name || '').trim(),
    nicheType: String(nicheProfile.niche_type || nicheProfile.nicheType || '').trim().toLowerCase(),
    nicheConfidence: toFiniteBoundaryConfidence(nicheProfile.confidence),
    boundaryConfidence: toFiniteBoundaryConfidence(entityObject.boundary_confidence ?? entityObject.boundaryConfidence),
    confidenceModel: String(confidenceExplain.model || '').trim() || null,
    signalModel: String(
      entityObject.boundary_signal_model ??
      entityObject.signalModel ??
      signalSummary.score_model ??
      ''
    ).trim() || null,
    encoderPredictedCount: toFiniteCount(
      entityObject.encoder_region_predicted_count,
      entityObject.encoderPredictedCount
    ),
    encoderHighConfidenceCount: toFiniteCount(
      entityObject.encoder_region_high_confidence_count,
      entityObject.encoderHighConfidenceCount
    ),
    vectorConstraintSource: String(
      entityObject.vector_constraint_source ??
      entityObject.vectorConstraintSource ??
      signalSummary.vector_constraint_source ??
      ''
    ).trim() || null,
    waterPenalty: toFiniteBoundaryConfidence(boundaryQuality.water_penalty ?? boundaryQuality.waterPenalty),
    waterOverlapRatio: toFiniteBoundaryConfidence(boundaryQuality.water_overlap_ratio ?? boundaryQuality.waterOverlapRatio),
    reasonTypes,
    topLanduseLabels
  }
}

export function buildBoundaryPopupLines(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object') return []
  const metaObject = meta as AiBoundaryMeta

  const lines: string[] = []

  if (metaObject.anchorName) {
    lines.push(`锚点 ${metaObject.anchorName}`)
  }
  if (metaObject.nicheType) {
    const nicheText = `生态位 ${nicheLabel(metaObject.nicheType)}`
    const nicheConfidence = toFiniteBoundaryConfidence(metaObject.nicheConfidence)
    lines.push(nicheConfidence === null ? nicheText : `${nicheText} ${formatLegendPercent(nicheConfidence)}`)
  }

  const boundaryConfidence = toFiniteBoundaryConfidence(metaObject.boundaryConfidence)
  if (boundaryConfidence !== null) {
    const model = metaObject.confidenceModel ? ` / ${metaObject.confidenceModel}` : ''
    lines.push(`边界可信 ${formatLegendPercent(boundaryConfidence)}${model}`)
  }

  const waterPenalty = toFiniteBoundaryConfidence(metaObject.waterPenalty)
  if (waterPenalty !== null && waterPenalty > 0) {
    lines.push(`水域惩罚 ${formatLegendPercent(waterPenalty)}`)
  }

  if (Array.isArray(metaObject.topLanduseLabels) && metaObject.topLanduseLabels.length > 0) {
    lines.push(`用地 ${metaObject.topLanduseLabels.join(' / ')}`)
  }

  if (Array.isArray(metaObject.reasonTypes) && metaObject.reasonTypes.length > 0) {
    const reasonTags: string[] = []
    if (metaObject.reasonTypes.includes('anchor')) reasonTags.push('关键词')
    if (metaObject.reasonTypes.includes('landuse')) reasonTags.push('用地')
    if (metaObject.reasonTypes.includes('water_context')) reasonTags.push('水域')
    if (reasonTags.length > 0) {
      lines.push(`约束 ${reasonTags.join(' / ')}`)
    }
  }

  const encoderPredictedCount = toFiniteCount(metaObject.encoderPredictedCount)
  const encoderHighConfidenceCount = toFiniteCount(metaObject.encoderHighConfidenceCount)
  if (encoderPredictedCount !== null || encoderHighConfidenceCount !== null) {
    const predictedText = encoderPredictedCount !== null ? `${encoderPredictedCount}` : '--'
    const confidentText = encoderHighConfidenceCount !== null ? `${encoderHighConfidenceCount}` : '--'
    lines.push(`编码器 ${predictedText}/${confidentText}`)
  }
  if (metaObject.vectorConstraintSource) {
    lines.push(`约束源 ${metaObject.vectorConstraintSource}`)
  }
  if (metaObject.signalModel) {
    lines.push(`信号 ${metaObject.signalModel}`)
  }

  return lines.slice(0, 4)
}
