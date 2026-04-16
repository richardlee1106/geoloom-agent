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

function readFiniteNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function shouldDiversifyNearbyIntent(intent: DeterministicIntent) {
  return intent.queryType === 'nearby_poi'
    && !isMetroIntent(intent)
    && Number(intent.radiusM || 0) >= 1400
}

function distanceBand(distanceM: number | null, radiusM: number) {
  if (!Number.isFinite(Number(distanceM))) return 0

  const safeRadius = Math.max(Number(radiusM || 0), 800)
  const nearBand = Math.min(420, Math.round(safeRadius * 0.28))
  const midBand = Math.min(960, Math.round(safeRadius * 0.58))
  const outerBand = Math.min(1700, Math.round(safeRadius * 0.84))

  if (Number(distanceM) <= nearBand) return 0
  if (Number(distanceM) <= midBand) return 1
  if (Number(distanceM) <= outerBand) return 2
  return 3
}

function coarseCellKey(lon: number | null, lat: number | null, radiusM: number, fallbackName: string) {
  if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) {
    return `name:${fallbackName}`
  }

  const gridStep = radiusM >= 2200
    ? 0.008
    : radiusM >= 1800
      ? 0.006
      : 0.0045

  return `cell:${Math.floor(Number(lon) / gridStep)}:${Math.floor(Number(lat) / gridStep)}`
}

interface NearbyRecordAccessors<T> {
  getDistance: (item: T) => number | null
  getLon: (item: T) => number | null
  getLat: (item: T) => number | null
  getName: (item: T) => string
}

function roundRobinCells<T>(items: T[]) {
  const queues = items.map((entry) => ({ entry }))
  return queues.map((item) => item.entry)
}

function diversifyNearbyRecords<T>(
  items: T[] = [],
  intent: DeterministicIntent,
  accessors: NearbyRecordAccessors<T>,
) {
  if (!shouldDiversifyNearbyIntent(intent) || items.length <= 4) {
    return items
  }

  const radiusM = Math.max(Number(intent.radiusM || 0), 1400)
  const prepared = items.map((item, index) => ({
    item,
    index,
    distanceM: accessors.getDistance(item),
    lon: accessors.getLon(item),
    lat: accessors.getLat(item),
    name: accessors.getName(item),
  }))

  const spreadReadyCount = prepared.filter((item) => Number.isFinite(Number(item.distanceM))).length
  if (spreadReadyCount < 5) {
    return items
  }

  const bands = new Map<number, Map<string, typeof prepared>>()
  for (const item of prepared) {
    const band = distanceBand(item.distanceM, radiusM)
    const cellKey = coarseCellKey(item.lon, item.lat, radiusM, item.name)
    const bandBuckets = bands.get(band) || new Map<string, typeof prepared>()
    const bucket = bandBuckets.get(cellKey) || []
    bucket.push(item)
    bandBuckets.set(cellKey, bucket)
    bands.set(band, bandBuckets)
  }

  const bandQueues = new Map<number, typeof prepared>()
  for (const band of [0, 1, 2, 3]) {
    const bandBuckets = bands.get(band)
    if (!bandBuckets || bandBuckets.size === 0) continue

    const orderedBuckets = [...bandBuckets.values()].sort((left, right) => {
      const leftDistance = Number(left[0]?.distanceM ?? Number.POSITIVE_INFINITY)
      const rightDistance = Number(right[0]?.distanceM ?? Number.POSITIVE_INFINITY)
      return leftDistance - rightDistance
    })

    const queue: typeof prepared = []
    const working = orderedBuckets.map((bucket) => [...bucket].sort((left, right) => left.index - right.index))
    let added = true
    while (added) {
      added = false
      for (const bucket of working) {
        const next = bucket.shift()
        if (!next) continue
        queue.push(next)
        added = true
      }
    }

    bandQueues.set(band, roundRobinCells(queue))
  }

  const interleavePattern = [0, 1, 0, 2, 1, 0, 3, 2, 1, 0]
  const diversified: typeof prepared = []
  while (diversified.length < prepared.length) {
    let progressed = false
    for (const band of interleavePattern) {
      const queue = bandQueues.get(band)
      if (!queue || queue.length === 0) continue
      diversified.push(queue.shift()!)
      progressed = true
      if (diversified.length >= prepared.length) break
    }

    if (!progressed) {
      for (const queue of bandQueues.values()) {
        while (queue.length > 0) {
          diversified.push(queue.shift()!)
        }
      }
    }
  }

  return diversified.map((entry) => entry.item)
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
  if (isMetroIntent(intent)) {
    return dedupeTransportItems(items)
  }

  return diversifyNearbyRecords(items, intent, {
    getDistance: (item) => readFiniteNumber(item.distance_m),
    getLon: (item) => readFiniteNumber(item.longitude),
    getLat: (item) => readFiniteNumber(item.latitude),
    getName: (item) => String(item.name || ''),
  })
}

export function normalizeNearbyRowsByIntent(
  rows: Record<string, unknown>[] = [],
  intent: DeterministicIntent,
) {
  if (isMetroIntent(intent)) {
    return rows
  }

  return diversifyNearbyRecords(rows, intent, {
    getDistance: (row) => readFiniteNumber(row.distance_m),
    getLon: (row) => readFiniteNumber(row.longitude),
    getLat: (row) => readFiniteNumber(row.latitude),
    getName: (row) => String(row.name || ''),
  })
}
