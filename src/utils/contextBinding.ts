type PlainObject = Record<string, unknown>

export interface BuildViewportHashInput {
  viewport?: unknown[]
  drawMode?: unknown
  regions?: unknown[]
}

export interface ContextBindingEvent {
  viewport_hash: string
  client_view_id: string
  event_seq: number
  map_state_version: unknown
  captured_at_ms: number
  source: string
}

export interface ContextBindingManager {
  getClientViewId(): string
  getEventSeq(): number
  next(input?: {
    viewport?: unknown[]
    drawMode?: unknown
    regions?: unknown[]
    mapStateVersion?: unknown
    capturedAtMs?: unknown
    sourceOverride?: unknown
  }): ContextBindingEvent
}

interface NormalizedRegionForHash {
  id: string
  name: string
  type: string
  center: [number | null, number | null] | { lon: number | null; lat: number | null }
  poiCount: number
}

function asPlainObject(value: unknown): PlainObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeNumber(value: unknown, digits = 6): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number(numeric.toFixed(digits))
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const objectValue = value as PlainObject
  return Object.keys(objectValue)
    .sort()
    .reduce<PlainObject>((acc, key) => {
      acc[key] = sortObjectKeys(objectValue[key])
      return acc
    }, {})
}

function fnv1aHash(input = ''): string {
  let hash = 0x811c9dc5
  const text = String(input)
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeViewport(viewport: unknown[] = []): Array<number | null> {
  if (!Array.isArray(viewport) || viewport.length < 4) return []
  return viewport.slice(0, 4).map((item) => normalizeNumber(item, 6))
}

function normalizeRegionForHash(region: unknown = {}): NormalizedRegionForHash {
  const regionValue = asPlainObject(region)
  const centerValue = regionValue.center
  const center = Array.isArray(centerValue)
    ? [normalizeNumber(centerValue[0], 6), normalizeNumber(centerValue[1], 6)] as [number | null, number | null]
    : {
        lon: normalizeNumber(asPlainObject(centerValue).lon ?? asPlainObject(centerValue).lng ?? asPlainObject(centerValue).longitude, 6),
        lat: normalizeNumber(asPlainObject(centerValue).lat ?? asPlainObject(centerValue).latitude, 6)
      }
  const pois = Array.isArray(regionValue.pois) ? regionValue.pois : []

  return {
    id: normalizeText(regionValue.id),
    name: normalizeText(regionValue.name),
    type: normalizeText(regionValue.type),
    center,
    poiCount: Number(regionValue.poiCount ?? pois.length ?? 0) || 0
  }
}

function normalizeRegionsForHash(regions: unknown[] = []): NormalizedRegionForHash[] {
  if (!Array.isArray(regions)) return []
  return regions
    .map((region) => normalizeRegionForHash(region))
    .sort((a, b) => {
      const left = `${a.id}|${a.name}|${a.type}`
      const right = `${b.id}|${b.name}|${b.type}`
      return left.localeCompare(right)
    })
}

export function buildViewportHash({
  viewport = [],
  drawMode = 'none',
  regions = []
}: BuildViewportHashInput = {}): string {
  const canonicalPayload = sortObjectKeys({
    viewport: normalizeViewport(viewport),
    draw_mode: normalizeText(drawMode).toLowerCase() || 'none',
    regions: normalizeRegionsForHash(regions)
  })
  const serialized = JSON.stringify(canonicalPayload)
  return `sha1:${fnv1aHash(serialized)}`
}

function createClientViewId(seed: unknown = ''): string {
  const seedText = normalizeText(seed) || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const stablePart = fnv1aHash(seedText)
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `view_${stablePart}${randomPart}`
}

export function createContextBindingManager({
  seed = '',
  startSeq = 0,
  now = () => Date.now(),
  source = 'frontend_injected'
}: {
  seed?: unknown
  startSeq?: unknown
  now?: () => number
  source?: unknown
} = {}): ContextBindingManager {
  const clientViewId = createClientViewId(seed)
  let eventSeq = Math.max(0, Math.trunc(Number(startSeq) || 0))

  return {
    getClientViewId() {
      return clientViewId
    },
    getEventSeq() {
      return eventSeq
    },
    next({
      viewport = [],
      drawMode = 'none',
      regions = [],
      mapStateVersion = null,
      capturedAtMs = null,
      sourceOverride = null
    } = {}) {
      eventSeq += 1
      return {
        viewport_hash: buildViewportHash({
          viewport,
          drawMode,
          regions
        }),
        client_view_id: clientViewId,
        event_seq: eventSeq,
        map_state_version: mapStateVersion ?? null,
        captured_at_ms: Number.isFinite(Number(capturedAtMs))
          ? Math.max(0, Math.trunc(Number(capturedAtMs)))
          : Math.max(0, Math.trunc(Number(now()) || Date.now())),
        source: normalizeText(sourceOverride || source) || 'frontend_injected'
      }
    }
  }
}

export default {
  buildViewportHash,
  createContextBindingManager
}
