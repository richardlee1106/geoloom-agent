import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElNotification } from 'element-plus/es/components/notification/index'

type PlainObject = Record<string, unknown>
type RegionGeometryType = 'Polygon' | 'Circle'

export interface RegionColor {
  fill: string
  stroke: string
  text: string
}

export interface RegionCategoryStat {
  name: string
  count: number
}

export interface RegionStats {
  poiCount: number
  categories: Record<string, number>
  topCategories: RegionCategoryStat[]
}

export interface Region {
  id: number
  name: string
  type: RegionGeometryType
  geometry: unknown
  center: unknown
  boundaryWKT: string
  pois: unknown[]
  olFeature: unknown
  labelFeature: unknown
  stats: RegionStats | null
  color: RegionColor
  createdAt: Date
}

export interface RegionInput {
  type?: unknown
  geometry?: unknown
  center?: unknown
  boundaryWKT?: unknown
  pois?: unknown[]
  olFeature?: unknown
  labelFeature?: unknown
  stats?: RegionStats | null
}

export const MAX_REGIONS = 6

export const REGION_COLORS: readonly RegionColor[] = [
  { fill: 'rgba(52,152,219,0.2)', stroke: '#3498db', text: '#2980b9' },
  { fill: 'rgba(231,76,60,0.2)', stroke: '#e74c3c', text: '#c0392b' },
  { fill: 'rgba(46,204,113,0.2)', stroke: '#2ecc71', text: '#27ae60' },
  { fill: 'rgba(155,89,182,0.2)', stroke: '#9b59b6', text: '#8e44ad' },
  { fill: 'rgba(241,196,15,0.2)', stroke: '#f1c40f', text: '#f39c12' },
  { fill: 'rgba(230,126,34,0.2)', stroke: '#e67e22', text: '#d35400' }
]

const regions: Ref<Region[]> = ref([])
const activeRegionId: Ref<number | null> = ref(null)

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function toRegionType(value: unknown): RegionGeometryType {
  return value === 'Circle' ? 'Circle' : 'Polygon'
}

function calculateRegionStats(pois: unknown[] = []): RegionStats {
  if (!Array.isArray(pois) || pois.length === 0) {
    return { poiCount: 0, categories: {}, topCategories: [] }
  }

  const categories: Record<string, number> = {}
  pois.forEach((poi) => {
    const props = asPlainObject(asPlainObject(poi).properties || poi)
    const category = String(props['小类'] || props['中类'] || props['大类'] || props.category || '未分类')
    categories[category] = (categories[category] || 0) + 1
  })

  const topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  return {
    poiCount: pois.length,
    categories,
    topCategories
  }
}

export function useRegions() {
  const getNextRegionId = (): number | null => {
    const usedIds = new Set(regions.value.map((region) => region.id))
    for (let index = 1; index <= MAX_REGIONS; index += 1) {
      if (!usedIds.has(index)) return index
    }
    return null
  }

  const canAddRegion: ComputedRef<boolean> = computed(() => regions.value.length < MAX_REGIONS)

  const addRegion = (regionData?: RegionInput | null): Region | null => {
    if (regions.value.length >= MAX_REGIONS) {
      ElNotification({
        title: 'ѡѴ',
        message: `ֻܻ ${MAX_REGIONS} ѡɾѡӡ`,
        type: 'warning',
        duration: 4000
      })
      return null
    }

    const id = getNextRegionId()
    if (id === null) return null

    const normalizedInput = asPlainObject(regionData)
    const initialPois = Array.isArray(normalizedInput.pois) ? normalizedInput.pois : []
    const initialStats = normalizedInput.stats && typeof normalizedInput.stats === 'object'
      ? (normalizedInput.stats as RegionStats)
      : calculateRegionStats(initialPois)

    const region: Region = {
      id,
      name: `选区${id}`,
      type: toRegionType(normalizedInput.type),
      geometry: normalizedInput.geometry,
      center: normalizedInput.center,
      boundaryWKT: String(normalizedInput.boundaryWKT || ''),
      pois: initialPois,
      olFeature: normalizedInput.olFeature || null,
      labelFeature: normalizedInput.labelFeature || null,
      stats: initialStats,
      color: REGION_COLORS[id - 1],
      createdAt: new Date()
    }

    regions.value.push(region)
    activeRegionId.value = id

    console.log(`[Regions] 添加选区: ${region.name}, 当前共 ${regions.value.length} 个选区`)

    return region
  }

  const removeRegion = (regionId: number): Region | null => {
    const index = regions.value.findIndex((region) => region.id === regionId)
    if (index === -1) return null

    const removed = regions.value.splice(index, 1)[0] || null
    if (!removed) return null

    console.log(`[Regions] 删除选区: ${removed.name}`)

    if (activeRegionId.value === regionId) {
      activeRegionId.value = regions.value.length > 0 ? regions.value[0].id : null
    }

    return removed
  }

  const clearAllRegions = (): number => {
    const count = regions.value.length
    regions.value = []
    activeRegionId.value = null
    console.log(`[Regions] 清空所有选区 (共 ${count} 个)`)
    return count
  }

  const getRegion = (regionId: number): Region | null => {
    return regions.value.find((region) => region.id === regionId) || null
  }

  const getRegions = (regionIds: number[]): Region[] => {
    return regions.value.filter((region) => regionIds.includes(region.id))
  }

  const updateRegionPois = (regionId: number, pois: unknown[] = []): void => {
    const region = getRegion(regionId)
    if (!region) return
    region.pois = pois
    region.stats = calculateRegionStats(pois)
  }

  const getRegionsContext = () => {
    return regions.value.map((region) => ({
      id: region.id,
      name: region.name,
      type: region.type,
      boundaryWKT: region.boundaryWKT,
      center: region.center,
      poiCount: region.pois.length,
      stats: region.stats
    }))
  }

  const extractRegionReferences = (question: string): number[] => {
    const references: number[] = []
    const patterns = [
      /选区\s*(\d+)/g,
      /区域\s*(\d+)/g,
      /\s*(\d+)\s*?ѡ/g,
      /第\s*(\d+)\s*个?区域/g,
      /region\s*(\d+)/gi
    ]

    patterns.forEach((pattern) => {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(question)) !== null) {
        const id = Number.parseInt(match[1], 10)
        if (id >= 1 && id <= MAX_REGIONS && !references.includes(id)) {
          references.push(id)
        }
      }
    })

    return references.sort((a, b) => a - b)
  }

  return {
    regions,
    activeRegionId,
    canAddRegion,
    addRegion,
    removeRegion,
    clearAllRegions,
    getRegion,
    getRegions,
    updateRegionPois,
    getRegionsContext,
    extractRegionReferences,
    MAX_REGIONS,
    REGION_COLORS
  }
}
