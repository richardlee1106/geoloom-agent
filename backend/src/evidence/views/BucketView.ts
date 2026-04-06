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

export function buildBucketView(input: {
  anchor: ResolvedAnchor
  intent: DeterministicIntent
  rows: EvidenceItem[]
}): EvidenceView {
  const buckets = input.rows.reduce<Array<{ label: string, value: number }>>((accumulator, item) => {
    const label = item.category || '未分类'
    const existing = accumulator.find((bucket) => bucket.label === label)
    if (existing) {
      existing.value += 1
    } else {
      accumulator.push({ label, value: 1 })
    }
    return accumulator
  }, [])

  return {
    type: 'bucket',
    anchor: normalizeAnchor(input.anchor),
    items: input.rows,
    buckets,
    meta: {
      queryType: input.intent.queryType,
      targetCategory: input.intent.targetCategory,
    },
  }
}
