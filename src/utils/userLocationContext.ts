import { useProjection } from '../composables/map/useProjection'

const { toGcj02IfNeeded } = useProjection()
const EARTH_RADIUS_KM = 6371

type ReferenceCenter = {
  lon: number
  lat: number
}

type BrowserUserLocation = {
  lon: number
  lat: number
  rawLon: number
  rawLat: number
  coordSys: 'gcj02'
  rawCoordSys: 'wgs84'
  accuracyM: number | null
  source: 'browser_geolocation'
  capturedAt: string
}

type BrowserUserLocationReview = {
  reliable: boolean
  reason: 'invalid_coordinates' | 'accuracy_too_coarse' | 'far_from_reference' | 'ok'
  accuracyM: number | null
  distanceKm: number | null
}

type UserLocationSummary = {
  tone: 'active' | 'accent' | 'warning' | 'neutral'
  label: string
  detail: string
}

type UserLocationStatus = 'idle' | 'ready' | 'locating' | 'denied' | 'unsupported' | 'error'

interface PositionLike {
  coords?: {
    longitude?: unknown
    latitude?: unknown
    accuracy?: unknown
  } | null
  timestamp?: string | number | Date | null
}

interface UserLocationLike {
  lon?: unknown
  lat?: unknown
  accuracyM?: unknown
}

interface ReviewLike {
  reliable?: boolean
  reason?: unknown
  accuracyM?: unknown
}

interface ReferenceCandidate {
  lon?: unknown
  lng?: unknown
  longitude?: unknown
  lat?: unknown
  latitude?: unknown
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toRadians(value: number): number {
  return value * Math.PI / 180
}

function normalizeReferenceCenter(candidate: ReferenceCandidate | null | undefined): ReferenceCenter | null {
  const lon = toFiniteNumber(candidate?.lon ?? candidate?.lng ?? candidate?.longitude)
  const lat = toFiniteNumber(candidate?.lat ?? candidate?.latitude)
  if (lon === null || lat === null) {
    return null
  }
  return { lon, lat }
}

function normalizeUserLocationStatus(status: unknown): UserLocationStatus | string {
  return String(status ?? 'idle').trim().toLowerCase()
}

function haversineDistanceKm(fromLon: number, fromLat: number, toLon: number, toLat: number): number {
  const dLat = toRadians(toLat - fromLat)
  const dLon = toRadians(toLon - fromLon)
  const startLat = toRadians(fromLat)
  const endLat = toRadians(toLat)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const a = sinLat * sinLat + Math.cos(startLat) * Math.cos(endLat) * sinLon * sinLon
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function toDisplayLonLat(
  lon: unknown,
  lat: unknown,
  sourceCoordSys: unknown = 'gcj02'
): [number | null, number | null] {
  const numericLon = toFiniteNumber(lon)
  const numericLat = toFiniteNumber(lat)
  if (numericLon === null || numericLat === null) {
    return [null, null]
  }
  return toGcj02IfNeeded(numericLon, numericLat, sourceCoordSys)
}

export function createBrowserUserLocation(position: PositionLike | null | undefined): BrowserUserLocation | null {
  const coords = position?.coords || {}
  const rawLon = toFiniteNumber(coords.longitude)
  const rawLat = toFiniteNumber(coords.latitude)

  if (rawLon === null || rawLat === null) {
    return null
  }

  const [lon, lat] = toDisplayLonLat(rawLon, rawLat, 'wgs84')
  if (lon === null || lat === null) {
    return null
  }

  const accuracyM = toFiniteNumber(coords.accuracy)
  const capturedAt = new Date(position?.timestamp || Date.now()).toISOString()

  return {
    lon,
    lat,
    rawLon,
    rawLat,
    coordSys: 'gcj02',
    rawCoordSys: 'wgs84',
    accuracyM,
    source: 'browser_geolocation',
    capturedAt
  }
}

export function assessBrowserUserLocation(
  userLocation: UserLocationLike | null | undefined,
  {
    referenceLon = null,
    referenceLat = null,
    maxReasonableAccuracyM = 1500,
    maxReferenceDistanceKm = 80,
    hardRejectAccuracyM = 5000
  }: {
    referenceLon?: unknown
    referenceLat?: unknown
    maxReasonableAccuracyM?: number
    maxReferenceDistanceKm?: number
    hardRejectAccuracyM?: number
  } = {}
): BrowserUserLocationReview {
  const lon = toFiniteNumber(userLocation?.lon)
  const lat = toFiniteNumber(userLocation?.lat)
  const accuracyM = toFiniteNumber(userLocation?.accuracyM)

  if (lon === null || lat === null) {
    return {
      reliable: false,
      reason: 'invalid_coordinates',
      accuracyM: null,
      distanceKm: null
    }
  }

  const normalizedReferenceLon = toFiniteNumber(referenceLon)
  const normalizedReferenceLat = toFiniteNumber(referenceLat)
  const hasReference = normalizedReferenceLon !== null && normalizedReferenceLat !== null
  const distanceKm = hasReference
    ? haversineDistanceKm(lon, lat, normalizedReferenceLon, normalizedReferenceLat)
    : null

  if (accuracyM !== null && accuracyM > hardRejectAccuracyM) {
    return {
      reliable: false,
      reason: 'accuracy_too_coarse',
      accuracyM,
      distanceKm
    }
  }

  if (distanceKm !== null && distanceKm > maxReferenceDistanceKm) {
    return {
      reliable: false,
      reason: 'far_from_reference',
      accuracyM,
      distanceKm
    }
  }

  if (accuracyM !== null && accuracyM > maxReasonableAccuracyM) {
    return {
      reliable: false,
      reason: 'accuracy_too_coarse',
      accuracyM,
      distanceKm
    }
  }

  return {
    reliable: true,
    reason: 'ok',
    accuracyM,
    distanceKm
  }
}

export function shouldRetryBrowserLocation(review: ReviewLike | null | undefined): boolean {
  if (!review || review.reliable) {
    return false
  }

  const reason = String(review.reason || '').trim().toLowerCase()
  const accuracyM = toFiniteNumber(review.accuracyM)

  if (reason === 'accuracy_too_coarse') {
    return true
  }

  if (reason === 'far_from_reference') {
    return accuracyM === null || accuracyM > 1000
  }

  return false
}

export function resolveLocationReferenceCenter({
  mapCenter = null,
  mapBounds = null,
  fallbackCenter = null
}: {
  mapCenter?: ReferenceCandidate | null
  mapBounds?: unknown[] | null
  fallbackCenter?: ReferenceCandidate | null
} = {}): ReferenceCenter | null {
  const normalizedMapCenter = normalizeReferenceCenter(mapCenter)
  if (normalizedMapCenter) {
    return normalizedMapCenter
  }

  if (Array.isArray(mapBounds) && mapBounds.length >= 4) {
    const minLon = toFiniteNumber(mapBounds[0])
    const minLat = toFiniteNumber(mapBounds[1])
    const maxLon = toFiniteNumber(mapBounds[2])
    const maxLat = toFiniteNumber(mapBounds[3])
    if (minLon !== null && minLat !== null && maxLon !== null && maxLat !== null) {
      return {
        lon: (minLon + maxLon) / 2,
        lat: (minLat + maxLat) / 2
      }
    }
  }

  return normalizeReferenceCenter(fallbackCenter)
}

export function getUserLocationSummary({
  userLocation = null,
  userLocationStatus = 'idle'
}: {
  userLocation?: UserLocationLike | null
  userLocationStatus?: unknown
} = {}): UserLocationSummary {
  switch (normalizeUserLocationStatus(userLocationStatus)) {
    case 'ready': {
      const accuracyM = toFiniteNumber(userLocation?.accuracyM)
      const accuracyText = accuracyM !== null
        ? `精度约 ${Math.round(accuracyM)} 米`
        : '设备位置已接管“我附近”类问题'
      return {
        tone: 'active',
        label: '当前位置已启用',
        detail: accuracyText
      }
    }
    case 'locating':
      return {
        tone: 'accent',
        label: '正在获取当前位置',
        detail: '等待浏览器返回设备位置'
      }
    case 'denied':
      return {
        tone: 'warning',
        label: '定位未授权',
        detail: '先授权当前位置，或直接说一个地点'
      }
    case 'unsupported':
      return {
        tone: 'warning',
        label: '当前环境不支持定位',
        detail: '继续按文本地点检索'
      }
    case 'error':
      return {
        tone: 'warning',
        label: '当前位置暂不可用',
        detail: '请重试定位，或直接输入地点'
      }
    default:
      return {
        tone: 'neutral',
        label: '当前使用文本锚点',
        detail: '附近会按问题里的地点来查'
      }
  }
}

export function getLocationActionLabel(userLocationStatus: unknown = 'idle'): string {
  switch (normalizeUserLocationStatus(userLocationStatus)) {
    case 'ready':
      return '更新位置'
    case 'denied':
      return '重新授权'
    case 'error':
      return '重试定位'
    case 'unsupported':
      return '地点锚点'
    default:
      return '使用当前位置'
  }
}
