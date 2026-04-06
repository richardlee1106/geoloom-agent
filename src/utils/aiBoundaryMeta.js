export function toFiniteBoundaryConfidence(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

export function confidenceBucket(score) {
  const value = toFiniteBoundaryConfidence(score)
  if (value === null) return 'unknown'
  if (value >= 0.7) return 'high'
  if (value >= 0.4) return 'medium'
  return 'low'
}

export function formatLegendPercent(value) {
  const score = toFiniteBoundaryConfidence(value)
  if (score === null) return '--'
  return `${Math.round(score * 100)}%`
}

export function nicheLabel(nicheType) {
  const normalized = String(nicheType || '').trim().toLowerCase()
  const labels = {
    ecology: '生态',
    commerce: '商业',
    education: '科教',
    mixed: '复合'
  }
  return labels[normalized] || normalized || '复合'
}

function toFiniteCount(...values) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function buildAiBoundaryMeta(entity = null, extra = {}) {
  if (!entity || typeof entity !== 'object') {
    return { ...(extra && typeof extra === 'object' ? extra : {}) }
  }

  const semanticAnchor = entity.semantic_anchor || entity.semanticAnchor || {}
  const nicheProfile = entity.niche_profile || entity.nicheProfile || {}
  const semanticReasoning = entity.semantic_reasoning || entity.semanticReasoning || {}
  const confidenceExplain = entity.confidence_explain || entity.confidenceExplain || {}
  const boundaryQuality = entity.boundary_quality || entity.boundaryQuality || {}
  const landuseSemantic = entity.landuse_semantic || entity.landuseSemantic || {}
  const signalSummary = entity.signal_summary || entity.signalSummary || {}

  const reasonTypes = Array.isArray(semanticReasoning.evidence)
    ? [...new Set(
        semanticReasoning.evidence
          .map((item) => String(item?.type || '').trim())
          .filter(Boolean)
      )]
    : []

  const topLabelCandidates = landuseSemantic.top_labels || landuseSemantic.topLabels || []
  const topLanduseLabels = Array.isArray(topLabelCandidates)
    ? topLabelCandidates
        .map((item) => String(item?.label || item || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : []

  return {
    ...extra,
    anchorName: String(semanticAnchor.name || '').trim(),
    nicheType: String(nicheProfile.niche_type || nicheProfile.nicheType || '').trim().toLowerCase(),
    nicheConfidence: toFiniteBoundaryConfidence(nicheProfile.confidence),
    boundaryConfidence: toFiniteBoundaryConfidence(entity.boundary_confidence ?? entity.boundaryConfidence),
    confidenceModel: String(confidenceExplain.model || '').trim() || null,
    signalModel: String(
      entity.boundary_signal_model ??
      entity.signalModel ??
      signalSummary.score_model ??
      ''
    ).trim() || null,
    encoderPredictedCount: toFiniteCount(
      entity.encoder_region_predicted_count,
      entity.encoderPredictedCount
    ),
    encoderHighConfidenceCount: toFiniteCount(
      entity.encoder_region_high_confidence_count,
      entity.encoderHighConfidenceCount
    ),
    vectorConstraintSource: String(
      entity.vector_constraint_source ??
      entity.vectorConstraintSource ??
      signalSummary.vector_constraint_source ??
      ''
    ).trim() || null,
    waterPenalty: toFiniteBoundaryConfidence(boundaryQuality.water_penalty ?? boundaryQuality.waterPenalty),
    waterOverlapRatio: toFiniteBoundaryConfidence(boundaryQuality.water_overlap_ratio ?? boundaryQuality.waterOverlapRatio),
    reasonTypes,
    topLanduseLabels
  }
}

export function buildBoundaryPopupLines(meta) {
  if (!meta || typeof meta !== 'object') return []

  const lines = []

  if (meta.anchorName) {
    lines.push(`锚点 ${meta.anchorName}`)
  }
  if (meta.nicheType) {
    const nicheText = `生态位 ${nicheLabel(meta.nicheType)}`
    const nicheConfidence = toFiniteBoundaryConfidence(meta.nicheConfidence)
    lines.push(nicheConfidence === null ? nicheText : `${nicheText} ${formatLegendPercent(nicheConfidence)}`)
  }

  const boundaryConfidence = toFiniteBoundaryConfidence(meta.boundaryConfidence)
  if (boundaryConfidence !== null) {
    const model = meta.confidenceModel ? ` / ${meta.confidenceModel}` : ''
    lines.push(`边界可信 ${formatLegendPercent(boundaryConfidence)}${model}`)
  }

  const waterPenalty = toFiniteBoundaryConfidence(meta.waterPenalty)
  if (waterPenalty !== null && waterPenalty > 0) {
    lines.push(`水域惩罚 ${formatLegendPercent(waterPenalty)}`)
  }

  if (Array.isArray(meta.topLanduseLabels) && meta.topLanduseLabels.length > 0) {
    lines.push(`用地 ${meta.topLanduseLabels.join(' / ')}`)
  }

  if (Array.isArray(meta.reasonTypes) && meta.reasonTypes.length > 0) {
    const reasonTags = []
    if (meta.reasonTypes.includes('anchor')) reasonTags.push('关键词')
    if (meta.reasonTypes.includes('landuse')) reasonTags.push('用地')
    if (meta.reasonTypes.includes('water_context')) reasonTags.push('水域')
    if (reasonTags.length > 0) {
      lines.push(`约束 ${reasonTags.join(' / ')}`)
    }
  }

  const encoderPredictedCount = toFiniteCount(meta.encoderPredictedCount)
  const encoderHighConfidenceCount = toFiniteCount(meta.encoderHighConfidenceCount)
  if (encoderPredictedCount !== null || encoderHighConfidenceCount !== null) {
    const predictedText = encoderPredictedCount !== null ? `${encoderPredictedCount}` : '--'
    const confidentText = encoderHighConfidenceCount !== null ? `${encoderHighConfidenceCount}` : '--'
    lines.push(`编码器 ${predictedText}/${confidentText}`)
  }
  if (meta.vectorConstraintSource) {
    lines.push(`约束源 ${meta.vectorConstraintSource}`)
  }
  if (meta.signalModel) {
    lines.push(`信号 ${meta.signalModel}`)
  }

  return lines.slice(0, 4)
}
