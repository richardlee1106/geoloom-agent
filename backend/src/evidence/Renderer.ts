import type { EvidenceView } from '../chat/types.js'

function formatDistance(distance: unknown) {
  const numeric = Number(distance)
  if (!Number.isFinite(numeric)) return '未知距离'
  if (numeric >= 1500) {
    return `${(numeric / 1000).toFixed(1)} 公里`
  }
  return `${Math.round(numeric)} 米`
}

function normalizeTransportName(name: unknown) {
  return String(name || '')
    .trim()
    .replace(/[（(]\s*地铁站\s*[)）]/gu, '地铁站')
}

function parseMetroExit(name: unknown) {
  const normalized = normalizeTransportName(name)
  const match = normalized.match(/^(.*?地铁站)([A-Z0-9一二三四五六七八九十]+口)$/u)

  return {
    stationName: match?.[1] || normalized,
    exitName: match?.[2] || null,
  }
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

    const radiusM = Number(view.meta.radiusM || 800)
    const targetCategory = String(view.meta.targetCategory || '相关地点')

    if (view.items.length === 0) {
      return `以${anchorName}为锚点，在 ${radiusM} 米范围内暂未找到${targetCategory === '相关地点' ? '' : targetCategory}结果。`
    }

    const lines = view.items
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.name}（${item.category || '未分类'}，约${formatDistance(item.distance_m)}）`)
      .join('\n')

    return `以${anchorName}为锚点，在 ${radiusM} 米范围内找到 ${view.items.length} 个${targetCategory === '相关地点' ? '相关地点' : `${targetCategory}相关地点`}：\n${lines}`
  }
}
