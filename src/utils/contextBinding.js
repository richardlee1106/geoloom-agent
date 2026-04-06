function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeNumber(value, digits = 6) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number(numeric.toFixed(digits))
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortObjectKeys(value[key])
      return acc
    }, {})
}

function fnv1aHash(input = '') {
  let hash = 0x811c9dc5
  const text = String(input)
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeViewport(viewport = []) {
  if (!Array.isArray(viewport) || viewport.length < 4) return []
  return viewport.slice(0, 4).map((item) => normalizeNumber(item, 6))
}

function normalizeRegionForHash(region = {}) {
  const center = Array.isArray(region?.center)
    ? region.center.slice(0, 2).map((value) => normalizeNumber(value, 6))
    : {
        lon: normalizeNumber(region?.center?.lon ?? region?.center?.lng ?? region?.center?.longitude, 6),
        lat: normalizeNumber(region?.center?.lat ?? region?.center?.latitude, 6)
      }

  return {
    id: normalizeText(region?.id),
    name: normalizeText(region?.name),
    type: normalizeText(region?.type),
    center,
    poiCount: Number(region?.poiCount ?? region?.pois?.length ?? 0) || 0
  }
}

function normalizeRegionsForHash(regions = []) {
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
} = {}) {
  const canonicalPayload = sortObjectKeys({
    viewport: normalizeViewport(viewport),
    draw_mode: normalizeText(drawMode).toLowerCase() || 'none',
    regions: normalizeRegionsForHash(regions)
  })
  const serialized = JSON.stringify(canonicalPayload)
  return `sha1:${fnv1aHash(serialized)}`
}

function createClientViewId(seed = '') {
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
} = {}) {
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
