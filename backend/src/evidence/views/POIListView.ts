import type { DeterministicIntent, EvidenceAnchor, EvidenceItem, EvidenceView, ResolvedAnchor } from '../../chat/types.js'

function normalizePoiItem(row: Record<string, unknown>): EvidenceItem {
  return {
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
  }
}

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

export function buildPOIListView(input: {
  anchor: ResolvedAnchor
  rows: Record<string, unknown>[]
  intent: DeterministicIntent
}): EvidenceView {
  return {
    type: 'poi_list',
    anchor: normalizeAnchor(input.anchor),
    items: input.rows.map(normalizePoiItem),
    meta: {
      resultCount: input.rows.length,
      radiusM: input.intent.radiusM,
      targetCategory: input.intent.targetCategory,
      queryType: input.intent.queryType,
    },
  }
}
