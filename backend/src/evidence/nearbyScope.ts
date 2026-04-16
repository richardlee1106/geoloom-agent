import type { DeterministicIntent } from '../chat/types.js'

const PRECISE_PLACE_ANCHOR_SUFFIX_RE = /(广场|商场|中心|大学|学院|学校|医院|公园|景区|地铁站|车站|机场|火车站|高铁站|步行街|大道|路|街|巷|里|社区|小区|写字楼|大厦|酒店|宾馆|园区|校区|楼|馆|店|村|寺|苑)$/u

export interface NearbyMacroScope {
  alias: string
  label: string
  districts: string[]
  districtIds: number[]
}

// 当前 districts 表缺少可用名称列，因此这里保留一份稳定的武汉片区别名 -> 行政区 / district_id 映射，
// 用来把“汉口 / 武昌 / 汉阳 / 光谷”这类宽泛锚点落成真正的空间约束。
const WUHAN_NEARBY_MACRO_SCOPES: NearbyMacroScope[] = [
  {
    alias: '汉口',
    label: '汉口片区',
    districts: ['江汉区', '江岸区', '硚口区'],
    districtIds: [4, 5, 6],
  },
  {
    alias: '武昌',
    label: '武昌片区',
    districts: ['武昌区'],
    districtIds: [7],
  },
  {
    alias: '汉阳',
    label: '汉阳片区',
    districts: ['汉阳区'],
    districtIds: [2],
  },
  {
    alias: '光谷',
    label: '光谷片区',
    districts: ['洪山区'],
    districtIds: [3],
  },
  {
    alias: '青山',
    label: '青山片区',
    districts: ['青山区'],
    districtIds: [8],
  },
]

export function isBroadNearbyPlaceAnchorName(placeName: unknown) {
  const normalized = String(placeName || '').trim()
  if (!normalized) return false
  return normalized.length <= 6 && !PRECISE_PLACE_ANCHOR_SUFFIX_RE.test(normalized)
}

export function isSoftScopedNearbyIntent(
  intent: Pick<DeterministicIntent, 'queryType' | 'anchorSource' | 'placeName' | 'categoryKey'>,
) {
  return intent.queryType === 'nearby_poi'
    && intent.categoryKey !== 'metro_station'
    && intent.anchorSource === 'place'
    && isBroadNearbyPlaceAnchorName(intent.placeName)
}

export function resolveNearbyMacroScope(input: {
  intent: Pick<DeterministicIntent, 'queryType' | 'anchorSource' | 'placeName' | 'categoryKey'>
  rawQuery?: unknown
  resolvedPlaceName?: unknown
}) {
  if (!isSoftScopedNearbyIntent(input.intent)) {
    return null
  }

  const probes = [
    String(input.intent.placeName || '').trim(),
    String(input.resolvedPlaceName || '').trim(),
    String(input.rawQuery || '').trim(),
  ].filter(Boolean)

  for (const scope of WUHAN_NEARBY_MACRO_SCOPES) {
    if (probes.some((probe) => probe.includes(scope.alias))) {
      return {
        ...scope,
        districts: [...scope.districts],
        districtIds: [...scope.districtIds],
      }
    }
  }

  return null
}
