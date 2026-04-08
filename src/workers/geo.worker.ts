type WorkerTagInput = Record<string, unknown> & {
  name: string
  lon?: number | null
  lat?: number | null
  weight?: number | null
}

type WorkerConfig = {
  fontMin?: number
  fontMax?: number
  minGap?: number
  minTagSpacing?: number
  angleStep?: number
  spiralStep?: number
  spiralSpacing?: number
  padding?: number
}

type WorkerRequest = {
  tags?: WorkerTagInput[]
  width?: number
  height?: number
  center?: [number, number] | null
  config?: WorkerConfig | null
}

type BaseLayoutTag = WorkerTagInput & {
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  originalIndex: number
  rotation?: number
  placed?: boolean
  isCenter?: boolean
}

type CenterTag = BaseLayoutTag & {
  name: '中心位置'
  isCenter: true
  quadrant: 0
  geoAngle: 0
  geoDistance: 0
}

type PreparedGeoTag = BaseLayoutTag & {
  geoDistance: number
  geoAngle: number
  quadrant: 1 | 2 | 3 | 4
  dLon?: number
  dLat?: number
  targetX: number
  targetY: number
  placed: boolean
}

type LayoutTagResult = BaseLayoutTag & {
  text: string
  rotation: number
  placed: boolean
  geoDistance?: number
  geoAngle?: number
  quadrant?: number
}

type WorkerDocument = {
  createElement: (tagName: string) => OffscreenCanvas | Record<string, never>
}

const workerScope = self as DedicatedWorkerGlobalScope
const workerDocumentScope = self as unknown as { document?: WorkerDocument }

if (typeof workerDocumentScope.document === 'undefined') {
  workerDocumentScope.document = {
    createElement: (tagName: string) => {
      if (tagName === 'canvas') {
        return new OffscreenCanvas(1, 1)
      }

      return {}
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasGeoCoordinates<T extends { lon?: unknown; lat?: unknown }>(
  value: T
): value is T & { lon: number; lat: number } {
  return isFiniteNumber(value.lon) && isFiniteNumber(value.lat)
}

function resolveConfig(config: WorkerConfig | null | undefined) {
  return {
    fontMin: isFiniteNumber(config?.fontMin) ? config.fontMin : 14,
    fontMax: isFiniteNumber(config?.fontMax) ? config.fontMax : 18,
    minGap: isFiniteNumber(config?.minTagSpacing)
      ? config.minTagSpacing
      : (isFiniteNumber(config?.minGap) ? config.minGap : 2),
    angleStep: isFiniteNumber(config?.angleStep) ? config.angleStep : 0.3,
    spiralStep: isFiniteNumber(config?.spiralSpacing)
      ? config.spiralSpacing
      : (isFiniteNumber(config?.spiralStep) ? config.spiralStep : 3),
    padding: isFiniteNumber(config?.padding) ? config.padding : 40
  }
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const {
    tags = [],
    width = 0,
    height = 0,
    center = null,
    config = null
  } = event.data || {}

  runGeoLayout(tags, width, height, center, config)
}

function runGeoLayout(
  tags: WorkerTagInput[],
  width: number,
  height: number,
  center: [number, number] | null,
  config: WorkerConfig | null
): void {
  if (!Array.isArray(tags) || tags.length === 0) {
    workerScope.postMessage([])
    return
  }

  console.log('[GeoWorker] 开始地理布局，标签数量:', tags.length)

  const resolvedConfig = resolveConfig(config)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    console.warn('[GeoWorker] 无法创建 2D 上下文')
    workerScope.postMessage([])
    return
  }

  const centerX = width / 2
  const centerY = height / 2
  const { fontMin, fontMax, minGap, angleStep, spiralStep, padding } = resolvedConfig

  let centerLon = 0
  let centerLat = 0

  if (
    Array.isArray(center)
    && center.length === 2
    && isFiniteNumber(center[0])
    && isFiniteNumber(center[1])
  ) {
    centerLon = center[0]
    centerLat = center[1]
  } else {
    let lonSum = 0
    let latSum = 0
    let count = 0

    tags.forEach((tag) => {
      if (!hasGeoCoordinates(tag)) {
        return
      }

      lonSum += tag.lon
      latSum += tag.lat
      count += 1
    })

    centerLon = count > 0 ? lonSum / count : 0
    centerLat = count > 0 ? latSum / count : 0
  }

  const centerTag: CenterTag = {
    name: '中心位置',
    isCenter: true,
    x: centerX,
    y: centerY,
    fontSize: fontMax + 4,
    originalIndex: -1,
    quadrant: 0,
    geoAngle: 0,
    geoDistance: 0,
    width: 0,
    height: 0
  }

  ctx.font = `900 ${centerTag.fontSize}px sans-serif`
  centerTag.width = Math.ceil(ctx.measureText(centerTag.name).width)
  centerTag.height = Math.ceil(centerTag.fontSize * 1.2)

  const latitudeRadians = (centerLat * Math.PI) / 180
  const longitudeFactor = Math.cos(latitudeRadians)

  let maxGeoDistance = 0
  const tagsWithGeo = tags.map((tag, index) => {
    if (!hasGeoCoordinates(tag)) {
      return {
        ...tag,
        geoDistance: 0,
        geoAngle: 0,
        quadrant: 1 as const,
        originalIndex: index
      }
    }

    const dLon = (tag.lon - centerLon) * longitudeFactor
    const dLat = tag.lat - centerLat
    const geoDistance = Math.sqrt(dLon * dLon + dLat * dLat)

    if (geoDistance > maxGeoDistance) {
      maxGeoDistance = geoDistance
    }

    const geoAngle = Math.atan2(dLat, dLon)
    let quadrant: 1 | 2 | 3 | 4

    if (dLon >= 0 && dLat >= 0) {
      quadrant = 1
    } else if (dLon < 0 && dLat >= 0) {
      quadrant = 2
    } else if (dLon < 0 && dLat < 0) {
      quadrant = 3
    } else {
      quadrant = 4
    }

    return {
      ...tag,
      geoDistance,
      geoAngle,
      quadrant,
      dLon,
      dLat,
      originalIndex: index
    }
  })

  if (maxGeoDistance === 0) {
    maxGeoDistance = 1
  }

  const availableRadius = Math.min(width, height) / 2 - padding
  const processedTags: PreparedGeoTag[] = tagsWithGeo.map((tag) => {
    const distanceRatio = 1 - (tag.geoDistance / maxGeoDistance)
    const fontSize = fontMin + distanceRatio * (fontMax - fontMin) * 0.3

    ctx.font = `${fontSize}px sans-serif`
    const textWidth = Math.ceil(ctx.measureText(tag.name).width)
    const textHeight = Math.ceil(fontSize * 1.2)
    const normalizedDistance = (tag.geoDistance / maxGeoDistance) * availableRadius * 0.9
    const targetX = centerX + normalizedDistance * Math.cos(tag.geoAngle)
    const targetY = centerY - normalizedDistance * Math.sin(tag.geoAngle)

    return {
      ...tag,
      fontSize,
      width: textWidth,
      height: textHeight,
      targetX,
      targetY,
      x: targetX,
      y: targetY,
      placed: false
    }
  })

  const hasWeights = processedTags.some((tag) => tag.weight !== undefined && tag.weight !== null && Number(tag.weight) > 0)

  if (hasWeights) {
    processedTags.sort((left, right) => (Number(right.weight) || 0) - (Number(left.weight) || 0))
    console.log(
      '[GeoWorker] 已按权重排序，前3个:',
      processedTags
        .slice(0, 3)
        .map((tag) => `${tag.name}(${(Number(tag.weight) || 0).toFixed(1)})`)
        .join(', ')
    )
  } else {
    processedTags.sort((left, right) => left.geoDistance - right.geoDistance)
  }

  const placedTags: Array<CenterTag | PreparedGeoTag> = [centerTag]
  const failedTags: PreparedGeoTag[] = []

  for (const tag of processedTags) {
    const position = findValidPosition(
      tag,
      placedTags,
      centerX,
      centerY,
      minGap,
      width,
      height,
      padding,
      spiralStep,
      angleStep
    )

    if (position) {
      tag.x = position.x
      tag.y = position.y
      tag.placed = true
      placedTags.push(tag)
      continue
    }

    tag.fontSize = fontMin * 0.8
    ctx.font = `${tag.fontSize}px sans-serif`
    tag.width = Math.ceil(ctx.measureText(tag.name).width)
    tag.height = Math.ceil(tag.fontSize * 1.2)

    const retryPosition = findValidPosition(
      tag,
      placedTags,
      centerX,
      centerY,
      minGap,
      width,
      height,
      padding,
      spiralStep,
      angleStep
    )

    if (retryPosition) {
      tag.x = retryPosition.x
      tag.y = retryPosition.y
      tag.placed = true
      placedTags.push(tag)
    } else {
      failedTags.push(tag)
    }
  }

  console.log('[GeoWorker] 布局完成，成功:', placedTags.length - 1, '失败:', failedTags.length)

  const results: LayoutTagResult[] = placedTags.map((tag) => {
    if (!tag.isCenter && tag.quadrant) {
      const isCorrectQuadrant = verifyQuadrant(tag.x, tag.y, centerX, centerY, tag.quadrant)
      if (!isCorrectQuadrant) {
        console.warn('[GeoWorker] 象限错误，强制修正:', tag.name)
        const corrected = forceCorrectQuadrant(tag, centerX, centerY)
        tag.x = corrected.x
        tag.y = corrected.y
      }
    }

    return {
      ...tag,
      text: tag.name,
      rotation: 0,
      placed: tag.placed !== false
    }
  })

  workerScope.postMessage(results)
}

function findValidPosition(
  tag: PreparedGeoTag,
  placedTags: Array<CenterTag | PreparedGeoTag>,
  centerX: number,
  centerY: number,
  minGap: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
  spiralStep: number,
  angleStep: number
): { x: number; y: number } | null {
  const maxAttempts = 500
  let theta = 0
  let attempt = 0

  while (attempt < maxAttempts) {
    const radius = (spiralStep * theta) / (2 * Math.PI)
    const offsetX = radius * Math.cos(theta)
    const offsetY = radius * Math.sin(theta)

    const testX = tag.targetX + offsetX
    const testY = tag.targetY + offsetY

    if (!verifyQuadrant(testX, testY, centerX, centerY, tag.quadrant)) {
      theta += angleStep
      attempt += 1
      continue
    }

    const halfWidth = tag.width / 2
    const halfHeight = tag.height / 2

    if (
      testX - halfWidth < padding
      || testX + halfWidth > canvasWidth - padding
      || testY - halfHeight < padding
      || testY + halfHeight > canvasHeight - padding
    ) {
      theta += angleStep
      attempt += 1
      continue
    }

    if (!hasCollision(testX, testY, tag.width, tag.height, placedTags, minGap)) {
      return { x: testX, y: testY }
    }

    theta += angleStep
    attempt += 1
  }

  return null
}

function verifyQuadrant(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  targetQuadrant: 1 | 2 | 3 | 4
): boolean {
  const isRight = x >= centerX
  const isUp = y <= centerY

  switch (targetQuadrant) {
    case 1:
      return isRight && isUp
    case 2:
      return !isRight && isUp
    case 3:
      return !isRight && !isUp
    case 4:
      return isRight && !isUp
    default:
      return true
  }
}

function forceCorrectQuadrant(
  tag: PreparedGeoTag,
  centerX: number,
  centerY: number
): { x: number; y: number } {
  let x = tag.x
  let y = tag.y
  const offset = 5

  switch (tag.quadrant) {
    case 1:
      if (x < centerX) x = centerX + offset
      if (y > centerY) y = centerY - offset
      break
    case 2:
      if (x >= centerX) x = centerX - offset
      if (y > centerY) y = centerY - offset
      break
    case 3:
      if (x >= centerX) x = centerX - offset
      if (y <= centerY) y = centerY + offset
      break
    case 4:
      if (x < centerX) x = centerX + offset
      if (y <= centerY) y = centerY + offset
      break
  }

  return { x, y }
}

function hasCollision(
  x: number,
  y: number,
  width: number,
  height: number,
  placedTags: Array<CenterTag | PreparedGeoTag>,
  gap: number
): boolean {
  const halfWidth = width / 2 + gap
  const halfHeight = height / 2 + gap

  for (const other of placedTags) {
    const otherHalfWidth = other.width / 2
    const otherHalfHeight = other.height / 2
    const deltaX = Math.abs(x - other.x)
    const deltaY = Math.abs(y - other.y)

    if (deltaX < halfWidth + otherHalfWidth && deltaY < halfHeight + otherHalfHeight) {
      return true
    }
  }

  return false
}

export {}
