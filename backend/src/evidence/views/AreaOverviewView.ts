import type { DeterministicIntent, EvidenceAnchor, EvidenceItem, EvidenceView, ResolvedAnchor } from '../../chat/types.js'

function normalizeAnchor(anchor: ResolvedAnchor): EvidenceAnchor {
  return {
    placeName: anchor.place_name,
    displayName: anchor.display_name,
    resolvedPlaceName: anchor.resolved_place_name,
    lon: anchor.lon,
    lat: anchor.lat,
    source: anchor.source,
    coordSys: String(anchor.coord_sys || 'gcj02').trim().toLowerCase() || 'gcj02',
  }
}

function normalizeAreaItem(row: Record<string, unknown>): EvidenceItem {
  return {
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    coordSys: String(row.coord_sys || row.coordSys || 'gcj02').trim().toLowerCase() || 'gcj02',
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
  }
}

function buildBuckets(items: EvidenceItem[]) {
  return items
    .reduce<Array<{ label: string, value: number }>>((accumulator, item) => {
      const label = item.categoryMain || item.category || '未分类'
      const existing = accumulator.find((bucket) => bucket.label === label)
      if (existing) {
        existing.value += 1
      } else {
        accumulator.push({ label, value: 1 })
      }
      return accumulator
    }, [])
    .sort((left, right) => right.value - left.value)
}

export function buildAreaOverviewView(input: {
  anchor: ResolvedAnchor
  rows: Record<string, unknown>[]
  intent: DeterministicIntent
}): EvidenceView {
  const items = input.rows.map(normalizeAreaItem)

  return {
    type: 'area_overview',
    anchor: normalizeAnchor(input.anchor),
    items,
    buckets: buildBuckets(items),
    meta: {
      resultCount: items.length,
      radiusM: input.intent.radiusM,
      targetCategory: input.intent.targetCategory,
      queryType: input.intent.queryType,
    },
  }
}
