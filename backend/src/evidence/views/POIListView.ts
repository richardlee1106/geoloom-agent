import type { DeterministicIntent, EvidenceAnchor, EvidenceItem, EvidenceView, ResolvedAnchor } from '../../chat/types.js'
import { isSoftScopedNearbyIntent, resolveNearbyMacroScope } from '../nearbyScope.js'
import { normalizeNearbyItemsByIntent } from '../transportNormalization.js'

function normalizePoiItem(row: Record<string, unknown>): EvidenceItem {
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

export function buildPOIListView(input: {
  anchor: ResolvedAnchor
  rows: Record<string, unknown>[]
  items?: EvidenceItem[]
  intent: DeterministicIntent
}): EvidenceView {
  const nearbyMacroScope = resolveNearbyMacroScope({
    intent: input.intent,
    rawQuery: input.intent.rawQuery,
    resolvedPlaceName: input.anchor.resolved_place_name || input.anchor.place_name,
  })
  const sourceItems = Array.isArray(input.items) && input.items.length > 0
    ? input.items.map((item) => ({ ...item }))
    : input.rows.map(normalizePoiItem)
  const items = normalizeNearbyItemsByIntent(
    sourceItems,
    input.intent
  )

  return {
    type: 'poi_list',
    anchor: normalizeAnchor(input.anchor),
    items,
    meta: {
      resultCount: items.length,
      radiusM: input.intent.radiusM,
      distanceConstraintMode: isSoftScopedNearbyIntent(input.intent) ? 'soft' : 'hard',
      targetCategory: input.intent.targetCategory,
      queryType: input.intent.queryType,
      scopeLabel: nearbyMacroScope?.label || null,
      scopeDistricts: nearbyMacroScope?.districts || [],
      scopeAlias: nearbyMacroScope?.alias || null,
    },
  }
}
