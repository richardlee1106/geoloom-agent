import type { ComparisonPair, DeterministicIntent, EvidenceAnchor, EvidenceView, ResolvedAnchor } from '../../chat/types.js'

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

export function buildComparisonView(input: {
  anchor: ResolvedAnchor
  secondaryAnchor: ResolvedAnchor
  intent: DeterministicIntent
  pairs: ComparisonPair[]
}): EvidenceView {
  return {
    type: 'comparison',
    anchor: normalizeAnchor(input.anchor),
    secondaryAnchor: normalizeAnchor(input.secondaryAnchor),
    items: input.pairs.flatMap((pair) => pair.items),
    pairs: input.pairs,
    meta: {
      queryType: input.intent.queryType,
      targetCategory: input.intent.targetCategory,
      comparisonTarget: input.intent.comparisonTarget,
    },
  }
}
