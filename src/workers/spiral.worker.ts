type WorkerTagInput = Record<string, unknown> & {
  name: string
  weight?: number | null
}

type WorkerConfig = {
  fontMin: number
  fontMax: number
  minGap: number
  density: number
  spiralB: number
  angleStep: number
}

type WorkerRequest = {
  tags?: WorkerTagInput[]
  width?: number
  height?: number
  config?: Partial<WorkerConfig>
}

type ProcessedTag = WorkerTagInput & {
  text: string
  fontSize: number
  width: number
  height: number
  x: number
  y: number
  placed: boolean
  rotation: number
}

type SpiralPosition = {
  x: number
  y: number
}

type WorkerDocument = {
  createElement: (tagName: string) => OffscreenCanvas | Record<string, never>
}

const workerScope = self
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

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const {
    tags = [],
    width = 0,
    height = 0,
    config: userConfig = {}
  } = event.data || {}

  runSpiralLayout(tags, width, height, userConfig)
}

function runSpiralLayout(
  tags: WorkerTagInput[],
  width: number,
  height: number,
  configOverrides: Partial<WorkerConfig>
): void {
  if (!Array.isArray(tags) || tags.length === 0) {
    workerScope.postMessage([])
    return
  }

  console.log('[Worker] Running Spiral Layout')

  const config: WorkerConfig = {
    fontMin: 18,
    fontMax: 22,
    minGap: 5,
    density: 1,
    spiralB: 20,
    angleStep: 0.3,
    ...configOverrides
  }

  const centerX = width / 2
  const centerY = height / 2

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[Worker] Spiral: 无法创建 2D 上下文')
    workerScope.postMessage([])
    return
  }

  const hasWeights = tags.some((tag) => tag.weight !== undefined && tag.weight !== null && Number(tag.weight) > 0)
  let maxWeight = 1

  if (hasWeights) {
    maxWeight = Math.max(...tags.map((tag) => Number(tag.weight) || 0), 1)
    console.log('[Worker Spiral] 检测到权重数据, 最大权重:', maxWeight)
  }

  const processedTags: ProcessedTag[] = tags.map((tag, index) => {
    const totalTags = tags.length
    let fontSize: number

    if (hasWeights && tag.weight !== undefined && tag.weight !== null) {
      const normalizedWeight = Math.min(1, Math.max(0, Number(tag.weight) / maxWeight))
      fontSize = config.fontMin + normalizedWeight * (config.fontMax - config.fontMin)
    } else {
      const normalizedIndex = index / Math.max(1, totalTags - 1)
      const sizeRatio = 1 - Math.pow(normalizedIndex, 0.5)
      fontSize = config.fontMin + sizeRatio * (config.fontMax - config.fontMin)
    }

    ctx.font = `${fontSize}px sans-serif`
    const metrics = ctx.measureText(tag.name)
    const textWidth = Math.ceil(metrics.width)
    const textHeight = Math.ceil(fontSize * 1.2)

    return {
      ...tag,
      text: tag.name,
      fontSize,
      width: textWidth,
      height: textHeight,
      x: 0,
      y: 0,
      placed: false,
      rotation: 0
    }
  })

  if (hasWeights) {
    processedTags.sort((left, right) => (Number(right.weight) || 0) - (Number(left.weight) || 0))
    console.log(
      '[Worker Spiral] 已按权重排序, 前3个:',
      processedTags
        .slice(0, 3)
        .map((tag) => `${tag.name}(${(Number(tag.weight) || 0).toFixed(1)})`)
        .join(', ')
    )
  } else {
    processedTags.sort((left, right) => right.fontSize - left.fontSize)
  }

  const placedTags: ProcessedTag[] = []
  let failedCount = 0
  const failedSamples: string[] = []

  for (const tag of processedTags) {
    const position = findBestPosition(tag, placedTags, centerX, centerY, width, height, config)

    if (position) {
      tag.x = position.x
      tag.y = position.y
      tag.placed = true
      placedTags.push(tag)
    } else {
      failedCount += 1
      if (failedSamples.length < 3) {
        failedSamples.push(tag.name)
      }
    }
  }

  if (failedCount > 0) {
    console.warn('[Worker] Spiral: 有标签未能放置', {
      failedCount,
      total: processedTags.length,
      samples: failedSamples
    })
  }

  console.log('[Worker] Spiral Layout complete. Placed:', placedTags.length, 'Failed:', failedCount, 'Total:', processedTags.length)
  workerScope.postMessage(placedTags)
}

function findBestPosition(
  tag: ProcessedTag,
  placedTags: ProcessedTag[],
  centerX: number,
  centerY: number,
  canvasWidth: number,
  canvasHeight: number,
  config: WorkerConfig
): SpiralPosition | null {
  const originalMinGap = config.minGap
  const maxAttempts = 100000
  const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5

  const searchPhases = [
    { factor: 1.0, maxAttempts },
    { factor: 0.8, maxAttempts },
    { factor: 0.6, maxAttempts },
    { factor: 0.4, maxAttempts },
    { factor: 0.2, maxAttempts }
  ]

  for (const phase of searchPhases) {
    const currentMinGap = originalMinGap * phase.factor
    let theta = 0

    const a = 0
    const b = config.spiralB
    const density = config.density
    const angleStep = config.angleStep

    for (let attempt = 0; attempt < phase.maxAttempts; attempt += 1) {
      const radius = a + (b * theta / density)

      if (radius > maxRadius) {
        break
      }

      const x = centerX + radius * Math.cos(theta)
      const y = centerY + radius * Math.sin(theta)

      if (!isWithinCanvasBounds(x, y, tag, canvasWidth, canvasHeight, currentMinGap)) {
        theta += angleStep
        continue
      }

      if (!checkCollision(tag, x, y, placedTags, currentMinGap)) {
        return { x, y }
      }

      theta += angleStep
    }
  }

  return null
}

function checkCollision(
  newTag: Pick<ProcessedTag, 'width' | 'height'>,
  x: number,
  y: number,
  placedTags: ProcessedTag[],
  minGap: number
): boolean {
  const newRect = {
    left: x - newTag.width / 2 - minGap,
    right: x + newTag.width / 2 + minGap,
    top: y - newTag.height / 2 - minGap,
    bottom: y + newTag.height / 2 + minGap
  }

  for (const placedTag of placedTags) {
    const placedRect = {
      left: placedTag.x - placedTag.width / 2,
      right: placedTag.x + placedTag.width / 2,
      top: placedTag.y - placedTag.height / 2,
      bottom: placedTag.y + placedTag.height / 2
    }

    if (
      !(newRect.right < placedRect.left
      || newRect.left > placedRect.right
      || newRect.bottom < placedRect.top
      || newRect.top > placedRect.bottom)
    ) {
      return true
    }
  }

  return false
}

function isWithinCanvasBounds(
  x: number,
  y: number,
  tag: Pick<ProcessedTag, 'width' | 'height'>,
  canvasWidth: number,
  canvasHeight: number,
  minGap: number
): boolean {
  const halfWidth = tag.width / 2
  const halfHeight = tag.height / 2

  return (
    x - halfWidth - minGap >= 0
    && x + halfWidth + minGap <= canvasWidth
    && y - halfHeight - minGap >= 0
    && y + halfHeight + minGap <= canvasHeight
  )
}

export {}
