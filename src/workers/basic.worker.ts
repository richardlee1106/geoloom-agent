import RBush from 'rbush'

type WorkerTagInput = Record<string, unknown> & {
  name: string
  weight?: number | null
}

type WorkerConfig = {
  fontMin: number
  fontMax: number
  padding: number
  spiralStep: number
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

type TreeItem = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  tag: ProcessedTag
}

type WorkerDocument = {
  createElement: (tagName: string) => OffscreenCanvas | Record<string, never>
}

const workerScope = self
const workerDocumentScope = self as unknown as { document?: WorkerDocument }

// ============================================================================
// Web Worker 中 OffscreenCanvas 的 Polyfill
// ============================================================================
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

  runDynamicGravityLayout(tags, width, height, userConfig)
}

// 动态重心算法（基础布局）
function runDynamicGravityLayout(
  tags: WorkerTagInput[],
  width: number,
  height: number,
  configOverrides: Partial<WorkerConfig>
): void {
  if (!Array.isArray(tags) || tags.length === 0) {
    workerScope.postMessage([])
    return
  }

  console.log('[Worker] Running Dynamic Gravity Layout')

  const config: WorkerConfig = {
    fontMin: 18,
    fontMax: 22,
    padding: 2, // 最小间距
    spiralStep: 5, // 紧凑布局的小步长
    ...configOverrides
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[Worker] Basic: 无法创建 2D 上下文')
    workerScope.postMessage([])
    return
  }

  // 1. 预处理：测量和计算字体大小
  // 如果有权重，先找出最大权重用于归一化
  const hasWeights = tags.some((tag) => tag.weight !== undefined && tag.weight !== null && tag.weight > 0)
  let maxWeight = 1
  if (hasWeights) {
    maxWeight = Math.max(...tags.map((tag) => Number(tag.weight) || 0), 1)
    console.log('[Worker] 检测到权重数据, 最大权重:', maxWeight)
  }

  const processedTags: ProcessedTag[] = tags.map((tag, index) => {
    const totalTags = tags.length
    let fontSize: number

    if (hasWeights && tag.weight !== undefined && tag.weight !== null) {
      // 使用实际最大权重进行归一化（0-1 范围）
      const normalizedWeight = Math.min(1, Math.max(0, Number(tag.weight) / maxWeight))
      fontSize = config.fontMin + normalizedWeight * (config.fontMax - config.fontMin)
    } else {
      // 无权重时，按索引位置线性分配字体大小
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
      rotation: 0 // 基础布局不旋转
    }
  })

  // 这确保高权重的标签优先放置在中心位置
  if (hasWeights) {
    processedTags.sort((left, right) => (Number(right.weight) || 0) - (Number(left.weight) || 0))
    console.log(
      '[Worker] 已按权重排序, 前3个:',
      processedTags
        .slice(0, 3)
        .map((tag) => `${tag.name}(${(Number(tag.weight) || 0).toFixed(1)})`)
        .join(', ')
    )
  } else {
    processedTags.sort((left, right) => right.fontSize - left.fontSize)
  }

  // 2. 状态定义
  const placedTags: ProcessedTag[] = []
  // 使用 RBush 空间索引树来加速碰撞检测
  const tree = new RBush<TreeItem>()
  let currentCentroid = { x: width / 2, y: height / 2 }

  // 3. 核心循环：逐个放置标签
  let failedCount = 0
  const failedSamples: string[] = []

  for (let index = 0; index < processedTags.length; index += 1) {
    const tag = processedTags[index]

    // 确定搜索起点
    // 第一个词放置在画布中心，后续词放置在当前已放置词的重心位置
    const startX = index === 0 ? width / 2 : currentCentroid.x
    const startY = index === 0 ? height / 2 : currentCentroid.y

    // 径向搜索（寻找最近的无碰撞位置）
    const position = findPositionRadial(tag, startX, startY, tree, config, width, height)

    if (position) {
      tag.x = position.x
      tag.y = position.y
      tag.placed = true

      // 更新状态
      placedTags.push(tag)

      // 将新放置的标签插入 RBush 索引树
      const item: TreeItem = {
        minX: tag.x - tag.width / 2 - config.padding,
        minY: tag.y - tag.height / 2 - config.padding,
        maxX: tag.x + tag.width / 2 + config.padding,
        maxY: tag.y + tag.height / 2 + config.padding,
        tag
      }
      tree.insert(item)

      // 动态更新当前重心
      if (index === 0) {
        currentCentroid = { x: tag.x, y: tag.y }
      } else {
        const placedCountBeforeCurrent = placedTags.length - 1
        currentCentroid.x = (currentCentroid.x * placedCountBeforeCurrent + tag.x) / (placedCountBeforeCurrent + 1)
        currentCentroid.y = (currentCentroid.y * placedCountBeforeCurrent + tag.y) / (placedCountBeforeCurrent + 1)
      }
    } else {
      failedCount += 1
      if (failedSamples.length < 3) {
        failedSamples.push(tag.name)
      }
    }
  }

  if (failedCount > 0) {
    console.warn('[Worker] Basic: 有标签未能放置', {
      failedCount,
      total: processedTags.length,
      samples: failedSamples
    })
  }

  console.log('[Worker] Basic Layout complete. Placed:', placedTags.length, 'Total:', processedTags.length)
  workerScope.postMessage(placedTags)
}

function findPositionRadial(
  tag: ProcessedTag,
  startX: number,
  startY: number,
  tree: RBush<TreeItem>,
  config: WorkerConfig,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } | null {
  const step = config.spiralStep
  let theta = 0
  const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5

  while (true) {
    // 螺旋轨迹公式: r = step * theta
    const radius = step * theta

    if (radius > maxRadius) break

    const x = startX + radius * Math.cos(theta)
    const y = startY + radius * Math.sin(theta)

    if (!isWithinCanvasBounds(x, y, tag, canvasWidth, canvasHeight)) {
      theta += 0.1
      continue
    }

    // 构建候选位置的包围盒（包含 padding）
    const minX = x - tag.width / 2 - config.padding
    const minY = y - tag.height / 2 - config.padding
    const maxX = x + tag.width / 2 + config.padding
    const maxY = y + tag.height / 2 + config.padding

    const candidateBox = { minX, minY, maxX, maxY }

    // 使用 RBush 进行高效的碰撞检测
    if (!tree.collides(candidateBox)) {
      return { x, y }
    }

    theta += 0.1
  }
  return null
}

function isWithinCanvasBounds(
  x: number,
  y: number,
  tag: Pick<ProcessedTag, 'width' | 'height'>,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const halfWidth = tag.width / 2
  const halfHeight = tag.height / 2

  return (
    x - halfWidth >= 0
    && x + halfWidth <= canvasWidth
    && y - halfHeight >= 0
    && y + halfHeight <= canvasHeight
  )
}
