type WorkerTagInput = Record<string, unknown> & {
  name: string
  lon?: number | null
  lat?: number | null
  coordKey?: string
}

type WorkerRequest = {
  tags?: WorkerTagInput[]
  width?: number
  height?: number
  center?: [number, number] | null
}

type WorkerConfig = {
  fontMin: number
  fontMax: number
  ringSpacing: number
  minTagSpacing: number
  numRings: number
  centerMargin: number
  gravityStrength: number
  iterations: number
  maxRadius: number
}

type GeoCenter = {
  lon: number
  lat: number
}

type GeoCoordinates = {
  lon: number
  lat: number
}

type ProcessedTag = WorkerTagInput & {
  bearing: number
  distance: number
  fontSize: number
  width: number
  ring: number
  x: number
  y: number
}

type LayoutTagResult = {
  name: string
  x: number
  y: number
  fontSize: number
  lon?: number | null
  lat?: number | null
  coordKey?: string
  ring?: number
  bearing?: number
  distance?: number
  isCenter?: boolean
}

const workerScope = self as DedicatedWorkerGlobalScope

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasGeoCoordinates<T extends { lon?: unknown; lat?: unknown }>(
  value: T
): value is T & GeoCoordinates {
  return isFiniteNumber(value.lon) && isFiniteNumber(value.lat)
}

function getAdaptiveConfig(width: number, height: number, tagCount: number): WorkerConfig {
  const minDimension = Math.min(width, height)
  const area = width * height
  const areaPerTag = area / Math.max(1, tagCount)

  let idealFontSize = Math.sqrt(areaPerTag / 3)
  idealFontSize = Math.max(8, Math.min(16, idealFontSize))

  const scaleFactor = Math.max(0.6, Math.min(1.2, minDimension / 500))

  const fontMin = Math.max(8, idealFontSize * 0.8 * scaleFactor)
  const fontMax = Math.max(10, idealFontSize * 1.2 * scaleFactor)

  const maxRadius = (minDimension / 2) - 20
  const numRings = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(tagCount / 3))))
  const ringSpacing = maxRadius / (numRings + 0.5)

  return {
    fontMin,
    fontMax,
    ringSpacing,
    minTagSpacing: 2,
    numRings,
    centerMargin: ringSpacing * 0.5,
    gravityStrength: 0.1,
    iterations: Math.min(80, tagCount),
    maxRadius
  }
}

function calculateBearing(
  centerLon: number,
  centerLat: number,
  pointLon: number,
  pointLat: number
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const toDegrees = (radians: number) => (radians * 180) / Math.PI

  const deltaLon = toRadians(pointLon - centerLon)
  const lat1 = toRadians(centerLat)
  const lat2 = toRadians(pointLat)

  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = (
    Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  )

  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadius = 6371000
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180

  const deltaLat = toRadians(lat2 - lat1)
  const deltaLon = toRadians(lon2 - lon1)

  const a = (
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2
  )

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function measureText(text: string, fontSize: number): number {
  if (!text) {
    return 0
  }

  let width = 0
  for (const char of text) {
    width += /[\u4e00-\u9fa5]/.test(char) ? fontSize : fontSize * 0.5
  }

  return width
}

function assignRings(tags: ProcessedTag[], numRings: number): ProcessedTag[] {
  if (tags.length === 0) {
    return []
  }

  const sorted = [...tags].sort((left, right) => left.distance - right.distance)
  const perRing = Math.ceil(sorted.length / numRings)

  sorted.forEach((tag, index) => {
    tag.ring = Math.min(Math.floor(index / perRing), numRings - 1)
  })

  return sorted
}

function checkOverlap(tagA: ProcessedTag, tagB: ProcessedTag, spacing: number): boolean {
  const deltaX = Math.abs(tagA.x - tagB.x)
  const deltaY = Math.abs(tagA.y - tagB.y)
  const halfWidth = (tagA.width + tagB.width) / 2 + spacing
  const halfHeight = (tagA.fontSize + tagB.fontSize) / 2 + spacing

  return deltaX < halfWidth && deltaY < halfHeight
}

function resolveCollisions(tags: ProcessedTag[], config: WorkerConfig, iterations = 20): void {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false

    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        if (!checkOverlap(tags[i], tags[j], config.minTagSpacing)) {
          continue
        }

        const deltaX = tags[j].x - tags[i].x || 0.1
        const deltaY = tags[j].y - tags[i].y || 0.1
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1

        const pushX = (deltaX / distance) * 2
        const pushY = (deltaY / distance) * 2

        tags[i].x -= pushX
        tags[i].y -= pushY
        tags[j].x += pushX
        tags[j].y += pushY
        moved = true
      }
    }

    if (!moved) {
      break
    }
  }
}

function resolveGeoCenter(
  center: WorkerRequest['center'],
  tags: WorkerTagInput[]
): GeoCenter | null {
  if (
    Array.isArray(center)
    && center.length === 2
    && isFiniteNumber(center[0])
    && isFiniteNumber(center[1])
  ) {
    return {
      lon: center[0],
      lat: center[1]
    }
  }

  let lonSum = 0
  let latSum = 0
  let count = 0

  for (const tag of tags) {
    if (!hasGeoCoordinates(tag)) {
      continue
    }

    lonSum += tag.lon
    latSum += tag.lat
    count += 1
  }

  if (count === 0) {
    return null
  }

  return {
    lon: lonSum / count,
    lat: latSum / count
  }
}

function layoutTags(data: WorkerRequest): LayoutTagResult[] {
  const {
    tags = [],
    width = 0,
    height = 0,
    center = null
  } = data

  if (!Array.isArray(tags) || tags.length === 0) {
    return []
  }

  console.log(`[GravityWorker] 布局 ${tags.length} 个标签, 容器: ${width}x${height}`)

  const config = getAdaptiveConfig(width, height, tags.length)
  console.log(
    `[GravityWorker] 配置: rings=${config.numRings}, font=${config.fontMin.toFixed(1)}-${config.fontMax.toFixed(1)}, spacing=${config.ringSpacing.toFixed(1)}`
  )

  const centerX = width / 2
  const centerY = height / 2
  const geoCenter = resolveGeoCenter(center, tags)

  const processed = tags.map((tag, index) => {
    let bearing = (index / tags.length) * 360
    let distance = 100 + index * 10

    if (
      geoCenter
      && hasGeoCoordinates(tag)
    ) {
      bearing = calculateBearing(geoCenter.lon, geoCenter.lat, tag.lon, tag.lat)
      distance = calculateDistance(geoCenter.lat, geoCenter.lon, tag.lat, tag.lon)
    }

    const fontSize = config.fontMin + (config.fontMax - config.fontMin) * Math.random()

    return {
      ...tag,
      bearing,
      distance,
      fontSize,
      width: measureText(tag.name || '', fontSize),
      ring: 0,
      x: centerX,
      y: centerY
    }
  })

  const tagsWithRings = assignRings(processed, config.numRings)
  const ringGroups = new Map<number, ProcessedTag[]>()

  tagsWithRings.forEach((tag) => {
    const group = ringGroups.get(tag.ring)

    if (group) {
      group.push(tag)
      return
    }

    ringGroups.set(tag.ring, [tag])
  })

  ringGroups.forEach((ringTags, ringNumber) => {
    ringTags.sort((left, right) => left.bearing - right.bearing)

    const radius = config.centerMargin + ringNumber * config.ringSpacing

    ringTags.forEach((tag, index) => {
      const baseAngle = ((tag.bearing - 90) * Math.PI) / 180
      const offset = ((index * 0.1) * Math.PI) / 180

      tag.x = centerX + Math.cos(baseAngle + offset) * radius
      tag.y = centerY + Math.sin(baseAngle + offset) * radius
    })
  })

  resolveCollisions(tagsWithRings, config, config.iterations)

  tagsWithRings.forEach((tag) => {
    const margin = 5
    const halfWidth = tag.width / 2

    tag.x = Math.max(halfWidth + margin, Math.min(width - halfWidth - margin, tag.x))
    tag.y = Math.max(tag.fontSize, Math.min(height - margin, tag.y))
  })

  const result: LayoutTagResult[] = tagsWithRings.map((tag) => ({
    name: tag.name,
    x: tag.x,
    y: tag.y,
    fontSize: tag.fontSize,
    lon: tag.lon,
    lat: tag.lat,
    coordKey: tag.coordKey,
    ring: tag.ring,
    bearing: Math.round(tag.bearing),
    distance: Math.round(tag.distance)
  }))

  result.unshift({
    name: '中心位置',
    x: centerX,
    y: centerY,
    fontSize: 12,
    isCenter: true
  })

  console.log(`[GravityWorker] 完成: 渲染 ${result.length} 个标签`)
  return result
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const data = event.data || {}
  console.log('[GravityWorker] 收到:', data.tags?.length, '个标签')

  try {
    const result = layoutTags(data)
    workerScope.postMessage(result)
  } catch (error) {
    console.error('[GravityWorker] 错误:', error)
    workerScope.postMessage([])
  }
}

export {}
