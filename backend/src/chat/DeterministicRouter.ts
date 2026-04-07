import type { ChatRequestV4, DeterministicIntent } from './types.js'

interface CategoryHint {
  key: string
  label: string
  aliases: string[]
}

const CATEGORY_HINTS: CategoryHint[] = [
  {
    key: 'coffee',
    label: '咖啡',
    aliases: ['咖啡', '咖啡店', '咖啡馆', 'coffee'],
  },
  {
    key: 'food',
    label: '餐饮',
    aliases: ['餐饮', '吃饭', '小吃', '餐馆', '美食'],
  },
  {
    key: 'supermarket',
    label: '商超',
    aliases: ['商超', '超市', '商场', '便利店'],
  },
  {
    key: 'metro_station',
    label: '地铁站',
    aliases: ['地铁站', '地铁', '站点'],
  },
]

const AMBIGUOUS_ANCHORS = new Set(['这里', '这里附近', '这附近', '这片区', '当前区域', '当前片区', '此处'])
const CURRENT_AREA_RE = /(这里|这里附近|这附近|这片区|当前区域|当前片区|此处)/u
const AREA_OVERVIEW_RE = /(配套|业态|缺口|机会|主导业态|活力热点|热点|异常点|读懂当前区域|读懂这个区域|总结当前区域|看看.*配套|看看.*业态)/u

function normalizeSelectedCategories(selectedCategories: unknown[] = []) {
  return selectedCategories
    .flatMap((item) => {
      if (Array.isArray(item)) {
        return item[item.length - 1] ? [item[item.length - 1]] : []
      }
      return [item]
    })
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function stripDecorators(text: string) {
  return text
    .replace(/^(请问|请帮我|帮我|想知道|我想知道|请直接|麻烦你)\s*/u, '')
    .replace(/[？?！!。.\s]+$/u, '')
    .trim()
}

function sanitizeAnchor(rawAnchor: string) {
  const cleaned = stripDecorators(
    rawAnchor
      .replace(/^(离|从)\s*/u, '')
      .replace(/(有哪些|有什么|都有什么|最近的?|是什么|气质相似.*|附近.*|周边.*|餐饮活跃度.*).*$/u, '')
      .trim(),
  )

  if (!cleaned || AMBIGUOUS_ANCHORS.has(cleaned)) {
    return null
  }

  return cleaned
}

function extractNearbyAnchor(text: string) {
  const markerIndex = text.search(/附近|周边/u)
  if (markerIndex <= 0) return null
  return sanitizeAnchor(text.slice(0, markerIndex))
}

function extractNearestAnchor(text: string) {
  const markerIndex = text.search(/最近/u)
  if (markerIndex <= 0) return null
  return sanitizeAnchor(text.slice(0, markerIndex))
}

function extractCompareAnchors(text: string) {
  const match = text.match(/(?:比较|对比)(.+?)和(.+?)(?:附近|周边)?的/u)
  if (!match) {
    return {
      primary: null,
      secondary: null,
    }
  }

  return {
    primary: sanitizeAnchor(match[1]),
    secondary: sanitizeAnchor(match[2]),
  }
}

function extractSimilarAnchor(text: string) {
  const match = text.match(/和(.+?)(?:附近|周边)?(?:气质)?相似/u)
  if (!match) return null
  return sanitizeAnchor(match[1])
}

function inferCategoryFromText(text: string, selectedCategories: string[]) {
  const probes = [text, ...selectedCategories]
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)

  for (const hint of CATEGORY_HINTS) {
    if (probes.some((probe) => hint.aliases.some((alias) => probe.includes(alias.toLowerCase())))) {
      return {
        categoryKey: hint.key,
        targetCategory: hint.label,
      }
    }
  }

  return {
    categoryKey: null,
    targetCategory: null,
  }
}

function buildClarificationHint(queryType: DeterministicIntent['queryType']) {
  if (queryType === 'nearest_station') {
    return '请告诉我一个明确地点，例如“武汉大学最近的地铁站是什么”。'
  }

  if (queryType === 'area_overview') {
    return '请告诉我一个明确地点，或者把地图移动到你想分析的区域后再问我。'
  }

  if (queryType === 'similar_regions') {
    return '请告诉我一个明确参考地点，例如“和武汉大学周边气质相似的片区有哪些”。'
  }

  if (queryType === 'compare_places') {
    return '请给出两个明确地点，例如“比较武汉大学和湖北大学附近的餐饮活跃度”。'
  }

  return '请告诉我一个明确地点，例如“武汉大学附近有哪些咖啡店”。'
}

function buildUserLocationClarificationHint(queryType: DeterministicIntent['queryType']) {
  if (queryType === 'nearest_station') {
    return '如果你想问离你最近的地铁站，请先授权当前位置，或者告诉我一个明确地点。'
  }

  if (queryType === 'area_overview') {
    return '如果你想分析我附近的业态和配套，请先授权当前位置，或者把地图移动到目标区域。'
  }

  return '如果你想问我附近有什么，请先授权当前位置，或者直接告诉我一个明确地点。'
}

function hasUserLocation(request: ChatRequestV4) {
  const candidate = request.options?.spatialContext as Record<string, unknown> | undefined
  const userLocation = candidate?.userLocation as Record<string, unknown> | undefined
  const lon = Number(userLocation?.lon ?? userLocation?.lng ?? userLocation?.longitude)
  const lat = Number(userLocation?.lat ?? userLocation?.latitude)
  return Number.isFinite(lon) && Number.isFinite(lat)
}

function hasSpatialViewContext(request: ChatRequestV4) {
  const candidate = request.options?.spatialContext as Record<string, unknown> | undefined
  const viewport = Array.isArray(candidate?.viewport) ? candidate.viewport : []
  const boundary = Array.isArray(candidate?.boundary) ? candidate.boundary : []
  const center = candidate?.center

  if (viewport.length >= 4 || boundary.length >= 3) {
    return true
  }

  if (Array.isArray(center) && center.length >= 2) {
    return true
  }

  if (center && typeof center === 'object') {
    const lon = Number((center as Record<string, unknown>).lon ?? (center as Record<string, unknown>).lng ?? (center as Record<string, unknown>).longitude)
    const lat = Number((center as Record<string, unknown>).lat ?? (center as Record<string, unknown>).latitude)
    return Number.isFinite(lon) && Number.isFinite(lat)
  }

  return false
}

function isUserRelativeAnchor(text: string) {
  return /(我附近|我周边|离我最近|从我这里|从当前位置|我这里|当前位置|我周围)/u.test(text)
}

function hasCurrentAreaReference(text: string) {
  return CURRENT_AREA_RE.test(text)
}

function isAreaOverviewQuery(text: string) {
  return AREA_OVERVIEW_RE.test(text)
}

export class DeterministicRouter {
  route(request: ChatRequestV4): DeterministicIntent {
    const text = this.extractLastUserText(request.messages)
    const selectedCategories = normalizeSelectedCategories(request.options?.selectedCategories || [])
    const normalizedText = stripDecorators(text)
    const { categoryKey, targetCategory } = inferCategoryFromText(normalizedText, selectedCategories)
    const requestHasUserLocation = hasUserLocation(request)
    const requestHasSpatialView = hasSpatialViewContext(request)

    if (/(比较|对比)/u.test(normalizedText) && /和/u.test(normalizedText)) {
      const anchors = extractCompareAnchors(normalizedText)
      const needsClarification = !anchors.primary || !anchors.secondary
      return {
        queryType: 'compare_places',
        intentMode: 'agent_full_loop',
        rawQuery: normalizedText,
        placeName: anchors.primary,
        anchorSource: 'place',
        secondaryPlaceName: anchors.secondary,
        targetCategory: targetCategory || '餐饮',
        comparisonTarget: targetCategory || '餐饮活跃度',
        categoryKey: categoryKey || 'food',
        radiusM: 800,
        needsClarification,
        clarificationHint: needsClarification ? buildClarificationHint('compare_places') : null,
      }
    }

    if (isAreaOverviewQuery(normalizedText)) {
      const useUserLocationAnchor = isUserRelativeAnchor(normalizedText)
      if (useUserLocationAnchor) {
        return {
          queryType: 'area_overview',
          intentMode: 'agent_full_loop',
          rawQuery: normalizedText,
          placeName: null,
          anchorSource: 'user_location',
          targetCategory: '区域洞察',
          categoryKey: null,
          radiusM: 1200,
          needsClarification: !requestHasUserLocation,
          clarificationHint: requestHasUserLocation ? null : buildUserLocationClarificationHint('area_overview'),
        }
      }

      const placeName = extractNearbyAnchor(normalizedText)
      const useMapViewAnchor = !placeName && (hasCurrentAreaReference(normalizedText) || requestHasSpatialView)
      const needsClarification = useMapViewAnchor ? !requestHasSpatialView : !placeName

      return {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        rawQuery: normalizedText,
        placeName: useMapViewAnchor ? '当前区域' : placeName,
        anchorSource: useMapViewAnchor ? 'map_view' : 'place',
        targetCategory: '区域洞察',
        categoryKey: null,
        radiusM: 1200,
        needsClarification,
        clarificationHint: needsClarification ? buildClarificationHint('area_overview') : null,
      }
    }

    if (/(相似|像)/u.test(normalizedText) && /(片区|区域|周边|气质)/u.test(normalizedText)) {
      const placeName = extractSimilarAnchor(normalizedText)
      return {
        queryType: 'similar_regions',
        intentMode: 'agent_full_loop',
        rawQuery: normalizedText,
        placeName,
        anchorSource: 'place',
        targetCategory: '相似片区',
        categoryKey: 'semantic_region',
        radiusM: 1200,
        needsClarification: !placeName,
        clarificationHint: placeName ? null : buildClarificationHint('similar_regions'),
      }
    }

    if (/(附近|周边)/u.test(normalizedText)) {
      const useUserLocationAnchor = isUserRelativeAnchor(normalizedText)
      if (useUserLocationAnchor) {
        return {
          queryType: 'nearby_poi',
          intentMode: 'deterministic_visible_loop',
          rawQuery: normalizedText,
          placeName: null,
          anchorSource: 'user_location',
          targetCategory,
          categoryKey,
          radiusM: 800,
          needsClarification: !requestHasUserLocation,
          clarificationHint: requestHasUserLocation ? null : buildUserLocationClarificationHint('nearby_poi'),
        }
      }

      const placeName = extractNearbyAnchor(normalizedText)
      return {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: normalizedText,
        placeName,
        anchorSource: 'place',
        targetCategory,
        categoryKey,
        radiusM: 800,
        needsClarification: !placeName,
        clarificationHint: placeName ? null : buildClarificationHint('nearby_poi'),
      }
    }

    if (/最近/u.test(normalizedText) && /(地铁站|地铁|站点|站)/u.test(normalizedText)) {
      const useUserLocationAnchor = isUserRelativeAnchor(normalizedText)
      if (useUserLocationAnchor) {
        return {
          queryType: 'nearest_station',
          intentMode: 'agent_full_loop',
          rawQuery: normalizedText,
          placeName: null,
          anchorSource: 'user_location',
          targetCategory: '地铁站',
          categoryKey: 'metro_station',
          radiusM: 800,
          needsClarification: !requestHasUserLocation,
          clarificationHint: requestHasUserLocation ? null : buildUserLocationClarificationHint('nearest_station'),
        }
      }

      const placeName = extractNearestAnchor(normalizedText)
      return {
        queryType: 'nearest_station',
        intentMode: 'agent_full_loop',
        rawQuery: normalizedText,
        placeName,
        anchorSource: 'place',
        targetCategory: '地铁站',
        categoryKey: 'metro_station',
        radiusM: 800,
        needsClarification: !placeName,
        clarificationHint: placeName ? null : buildClarificationHint('nearest_station'),
      }
    }

    return {
      queryType: 'unsupported',
      intentMode: 'deterministic_visible_loop',
      rawQuery: normalizedText,
      placeName: null,
      anchorSource: 'place',
      targetCategory,
      categoryKey,
      radiusM: 800,
      needsClarification: true,
      clarificationHint: '当前 V4 已支持“某地附近有什么”“某地最近的地铁站”“当前区域洞察 / 业态配套分析”“相似片区”和“双地点比较”这几类问题。',
    }
  }

  extractLastUserText(messages: ChatRequestV4['messages'] = []) {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => String(message?.role || '').toLowerCase() === 'user')

    if (!lastUserMessage) return ''

    if (typeof lastUserMessage.content === 'string') {
      return lastUserMessage.content.trim()
    }

    if (Array.isArray(lastUserMessage.content)) {
      return lastUserMessage.content
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text?: unknown }).text || '')
          }
          return ''
        })
        .join(' ')
        .trim()
    }

    if (
      lastUserMessage.content &&
      typeof lastUserMessage.content === 'object' &&
      'text' in (lastUserMessage.content as Record<string, unknown>)
    ) {
      return String((lastUserMessage.content as { text?: unknown }).text || '').trim()
    }

    return String(lastUserMessage.content || '').trim()
  }
}
