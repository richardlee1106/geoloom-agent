import type { EvidenceView } from '../chat/types.js'
import { normalizeTransportName, parseMetroExit } from './transportNormalization.js'

function formatDistance(distance: unknown) {
  const numeric = Number(distance)
  if (!Number.isFinite(numeric)) return '未知距离'
  if (numeric >= 1500) {
    return `${(numeric / 1000).toFixed(1)} 公里`
  }
  return `${Math.round(numeric)} 米`
}

function humanizeCategoryLabel(label: unknown) {
  const normalized = String(label || '').trim()
  if (!normalized) return '未分类'

  const aliasMap: Record<string, string> = {
    '餐饮美食': '餐饮',
    '购物服务': '零售配套',
    '生活服务': '生活服务',
    '交通设施服务': '交通接驳',
    '科教文化服务': '教育文化',
    '医疗保健服务': '医疗配套',
    '体育休闲服务': '休闲活力',
    '住宿服务': '停留配套',
  }

  return aliasMap[normalized] || normalized
}

function pickExamplesByBucket(view: EvidenceView, labels: string[] = []) {
  return labels
    .map((label) => {
      const match = view.items.find((item) => (item.categoryMain || item.category || '未分类') === label)
      if (!match) return null
      return `${humanizeCategoryLabel(label)}（如 ${match.name}）`
    })
    .filter(Boolean)
}

function inferAreaOpportunity(buckets: Array<{ label: string, value: number }> = [], total = 0) {
  if (total <= 0) return '样本还不够，机会判断需要更多周边数据。'

  const bucketMap = new Map(buckets.map((bucket) => [bucket.label, bucket.value]))
  const focus = [
    ['生活服务', '日常生活服务还可以继续补位'],
    ['医疗保健服务', '医疗类配套偏弱，适合做补缺观察'],
    ['体育休闲服务', '休闲与停留型内容还有补充空间'],
    ['住宿服务', '停留型配套不算强，可以继续观察'],
  ] as const

  const missing = focus.find(([label]) => !bucketMap.has(label))
  if (missing) {
    return missing[1]
  }

  const sparse = focus.find(([label]) => (bucketMap.get(label) || 0) / total < 0.12)
  if (sparse) {
    return sparse[1]
  }

  return '结构已经比较完整，更值得盯住的是把高频业态做得更有差异化。'
}

export class Renderer {
  render(view: EvidenceView) {
    const anchorName = view.anchor.resolvedPlaceName || view.anchor.displayName || view.anchor.placeName || '该地点'

    if (view.type === 'comparison') {
      const summary = (view.pairs || [])
        .map((pair) => `${pair.label}${pair.value} 家`)
        .join('，')
      return `围绕 ${anchorName} 和 ${view.secondaryAnchor?.resolvedPlaceName || '另一个地点'} 做对比后，${summary}。`
    }

    if (view.type === 'semantic_candidate') {
      const names = view.items.slice(0, 3).map((item) => `${item.name}（相似度 ${((item.score || 0) * 100).toFixed(0)}%）`)
      return `以${anchorName}为参考，当前最相似的片区有：${names.join('，')}。`
    }

    if (view.type === 'bucket') {
      const lines = (view.buckets || []).map((bucket) => `${bucket.label} ${bucket.value} 个`)
      return `以${anchorName}为锚点，当前聚合结果显示：${lines.join('，')}。`
    }

    if (view.type === 'transport') {
      const nearest = view.items[0]
      const targetCategory = String(view.meta.targetCategory || '地铁站')

      if (!nearest) {
        return `以${anchorName}为锚点，附近暂未找到可用的${targetCategory}。`
      }

      const nearestStation = parseMetroExit(nearest.name)
      const exitNames = [...new Set(view.items
        .map((item) => parseMetroExit(item.name))
        .filter((item) => item.stationName === nearestStation.stationName && item.exitName)
        .map((item) => String(item.exitName)))]

      if (nearestStation.exitName && exitNames.length > 1) {
        return `以${anchorName}为锚点，最近的${targetCategory}是${nearestStation.stationName}，最近的出口是${nearestStation.exitName}，距离约${formatDistance(nearest.distance_m)}；可用站口包括${exitNames.join('、')}。`
      }

      return `以${anchorName}为锚点，最近的${targetCategory}是${nearest.name}，距离约${formatDistance(nearest.distance_m)}。`
    }

    if (view.type === 'area_overview') {
      const buckets = [...(view.buckets || [])].sort((left, right) => right.value - left.value)
      if (view.items.length === 0 || buckets.length === 0) {
        return `以${anchorName}为观察范围，当前还没有足够的周边样本，暂时没法稳定判断主导业态和机会。`
      }

      const dominant = buckets
        .slice(0, 3)
        .map((bucket) => `${humanizeCategoryLabel(bucket.label)}（${bucket.value}）`)
        .join('、')
      const hotspotExamples = pickExamplesByBucket(view, buckets.slice(0, 2).map((bucket) => bucket.label))
      const hotspotText = hotspotExamples.length > 0
        ? hotspotExamples.join('、')
        : '高频业态主要围绕头部品类展开'
      const topShare = buckets[0] ? buckets[0].value / Math.max(view.items.length, 1) : 0
      const anomalyText = topShare >= 0.45
        ? `${humanizeCategoryLabel(buckets[0].label)}占比明显偏高，结构有一点单一`
        : '异常点不算尖锐，整体更像常规混合片区'
      const opportunityText = inferAreaOpportunity(buckets, view.items.length)

      return `以${anchorName}为观察范围，当前样本里的主导业态是${dominant}；活力热点更集中在${hotspotText}；异常点是${anomalyText}；最值得继续盯住的机会是${opportunityText}。`
    }

    const radiusM = Number(view.meta.radiusM || 800)
    const targetCategory = String(view.meta.targetCategory || '相关地点')

    if (view.items.length === 0) {
      return `以${anchorName}为锚点，在 ${radiusM} 米范围内暂未找到${targetCategory === '相关地点' ? '' : targetCategory}结果。`
    }

    const visibleItems = view.items.length <= 8
      ? view.items
      : view.items.slice(0, 6)

    const lines = visibleItems
      .map((item, index) => `${index + 1}. ${item.name}（${item.category || '未分类'}，约${formatDistance(item.distance_m)}）`)
      .join('\n')

    const hiddenCount = Math.max(view.items.length - visibleItems.length, 0)
    const tail = hiddenCount > 0
      ? `\n其余 ${hiddenCount} 个结果可在地图和标签云里继续查看。`
      : ''

    return `以${anchorName}为锚点，在 ${radiusM} 米范围内找到 ${view.items.length} 个${targetCategory === '相关地点' ? '相关地点' : `${targetCategory}相关地点`}：\n${lines}${tail}`
  }
}
