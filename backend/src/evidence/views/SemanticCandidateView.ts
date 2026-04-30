import type {
  DeterministicIntent,
  EvidenceAnchor,
  EvidenceItem,
  EvidenceView,
  ResolvedAnchor,
  SimilarRegionDimension,
} from '../../chat/types.js'

function normalizeAnchor(anchor: ResolvedAnchor): EvidenceAnchor {
  return {
    placeName: anchor.place_name,
    displayName: anchor.display_name,
    resolvedPlaceName: anchor.resolved_place_name,
    lon: anchor.lon,
    lat: anchor.lat,
    source: anchor.source,
  }
}

export function buildSemanticCandidateView(input: {
  anchor: ResolvedAnchor
  intent: DeterministicIntent
  items: EvidenceItem[]
}): EvidenceView {
  const regions = input.items.map((item, index) => {
    const meta = item.meta && typeof item.meta === 'object'
      ? item.meta as Record<string, unknown>
      : {}
    const rawDimensions = Array.isArray(meta.dimensions) ? meta.dimensions : []
    const dimensions = rawDimensions
      .map((dimension) => {
        if (!dimension || typeof dimension !== 'object') return null
        const record = dimension as Record<string, unknown>
        const key = String(record.key || '').trim()
        const label = String(record.label || '').trim()
        const score = Number(record.score)
        if (!key || !label || !Number.isFinite(score)) {
          return null
        }
        return {
          key,
          label,
          score,
          detail: record.detail == null ? null : String(record.detail),
        } satisfies SimilarRegionDimension
      })
      .filter(Boolean) as SimilarRegionDimension[]

    return {
      regionId: String(meta.regionId || meta.region_id || item.id || '').trim() || null,
      name: item.name,
      score: item.score || 0,
      summary: String(meta.summary || '').trim(),
      rank: Number.isFinite(Number(meta.rank ?? item.rank)) ? Number(meta.rank ?? item.rank) : index + 1,
      tags: Array.isArray(meta.tags)
        ? meta.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [],
      dimensions,
    }
  })

  return {
    type: 'semantic_candidate',
    anchor: normalizeAnchor(input.anchor),
    items: input.items,
    regions,
    meta: {
      queryType: input.intent.queryType,
      targetCategory: input.intent.targetCategory,
    },
  }
}
