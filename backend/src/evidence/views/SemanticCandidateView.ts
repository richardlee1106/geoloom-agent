import type { DeterministicIntent, EvidenceAnchor, EvidenceItem, EvidenceView, ResolvedAnchor } from '../../chat/types.js'

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
  return {
    type: 'semantic_candidate',
    anchor: normalizeAnchor(input.anchor),
    items: input.items,
    regions: input.items.map((item) => ({
      name: item.name,
      score: item.score || 0,
      summary: String(item.meta?.summary || ''),
    })),
    meta: {
      queryType: input.intent.queryType,
      targetCategory: input.intent.targetCategory,
    },
  }
}
