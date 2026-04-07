import type { DeterministicIntent, EvidenceItem } from '../chat/types.js'

export function normalizeTransportName(name: unknown) {
  return String(name || '')
    .trim()
    .replace(/[（(]\s*地铁站\s*[)）]/gu, '地铁站')
}

export function parseMetroExit(name: unknown) {
  const normalized = normalizeTransportName(name)
  const match = normalized.match(/^(.*?地铁站)([A-Z0-9一二三四五六七八九十]+口)$/u)

  return {
    stationName: match?.[1] || normalized,
    exitName: match?.[2] || null,
  }
}

function isMetroIntent(intent: DeterministicIntent) {
  return intent.categoryKey === 'metro_station' || intent.targetCategory === '地铁站'
}

export function dedupeTransportItems(items: EvidenceItem[] = []) {
  const groups = new Map<string, { exits: Map<string, EvidenceItem>, generic: EvidenceItem | null, bestDistance: number }>()

  const sorted = [...items].sort((left, right) => {
    const leftDistance = Number.isFinite(Number(left.distance_m)) ? Number(left.distance_m) : Number.POSITIVE_INFINITY
    const rightDistance = Number.isFinite(Number(right.distance_m)) ? Number(right.distance_m) : Number.POSITIVE_INFINITY
    return leftDistance - rightDistance
  })

  for (const item of sorted) {
    const parsed = parseMetroExit(item.name)
    const key = parsed.stationName || normalizeTransportName(item.name)
    const existing = groups.get(key) || {
      exits: new Map<string, EvidenceItem>(),
      generic: null,
      bestDistance: Number.POSITIVE_INFINITY
    }

    const distance = Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : Number.POSITIVE_INFINITY
    existing.bestDistance = Math.min(existing.bestDistance, distance)

    if (parsed.exitName) {
      if (!existing.exits.has(parsed.exitName)) {
        existing.exits.set(parsed.exitName, item)
      }
    } else if (!existing.generic) {
      existing.generic = item
    }

    groups.set(key, existing)
  }

  return [...groups.entries()]
    .sort((left, right) => left[1].bestDistance - right[1].bestDistance)
    .flatMap(([, group]) => {
      if (group.exits.size > 0) {
        return [...group.exits.values()]
      }
      return group.generic ? [group.generic] : []
    })
}

export function normalizeNearbyItemsByIntent(items: EvidenceItem[] = [], intent: DeterministicIntent) {
  if (!isMetroIntent(intent)) return items
  return dedupeTransportItems(items)
}
