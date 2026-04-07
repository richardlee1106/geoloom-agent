import type { DeterministicIntent, EvidenceAnchor, EvidenceItem, EvidenceView, ResolvedAnchor } from '../../chat/types.js'
import { dedupeTransportItems } from '../transportNormalization.js'

function normalizeTransportItem(row: Record<string, unknown>): EvidenceItem {
  return {
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名站点',
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

export function buildTransportView(input: {
  anchor: ResolvedAnchor
  rows: Record<string, unknown>[]
  intent: DeterministicIntent
}): EvidenceView {
  const items = dedupeTransportItems(input.rows.map(normalizeTransportItem))

  return {
    type: 'transport',
    anchor: normalizeAnchor(input.anchor),
    items,
    meta: {
      resultCount: items.length,
      targetCategory: input.intent.targetCategory || '地铁站',
      queryType: input.intent.queryType,
    },
  }
}
