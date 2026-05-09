import type {
  NarrativeChapter,
  NarrativePathNode,
  NarrativePoi,
  NarrativeRegion,
  NarrativeResponse,
  PathNarrationRole,
  TierStats
} from './types'

export interface NarrativeDisplayRegion extends NarrativeRegion {
  chapter_label: string
}

export interface NarrativeDisplayPathNode extends NarrativePathNode {
  chapter_label: string
  display_name: string
}

export interface NarrativeDisplayModel {
  response: NarrativeResponse
  regions: NarrativeDisplayRegion[]
  regionMap: Record<string, NarrativeDisplayRegion>
  pathNodes: NarrativeDisplayPathNode[]
  chapters: NarrativeChapter[]
  allRenderablePois: NarrativePoi[]
  tierStats: TierStats
}

const CHAPTER_LABEL_BY_ROLE: Record<PathNarrationRole, string> = {
  core: '核心',
  related: '关联',
  cultural: '文化',
  landmark: '地标',
  educational: '教育',
  ecological: '生态'
}

const TIER_ORDER: Record<NarrativePoi['tier'], number> = {
  core: 0,
  strong: 1,
  medium: 2,
  weak: 3,
  excluded: 4
}
const INVALID_REGION_NAME_RE = /^(none|null|undefined|nan|未命名|未命名地点|未知|未知地点)$/i

export function labelForNarrationRole(role: PathNarrationRole): string {
  return CHAPTER_LABEL_BY_ROLE[role] ?? '解说'
}

function normalizeRegionKey(value: string): string {
  return value
    .trim()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/(公园|景区|风景区|旅游区)$/u, '')
}

function isUsableRegionName(value: string): boolean {
  const normalized = value.trim()
  return Boolean(normalized) && !INVALID_REGION_NAME_RE.test(normalized)
}

function pointInRegionBoundary(poi: NarrativePoi, region: NarrativeRegion): boolean {
  const ring = region.boundary.coordinates[0] ?? []
  if (ring.length < 4) return true
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > poi.lat) !== (yj > poi.lat))
      && (poi.lon < (xj - xi) * (poi.lat - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function poiKey(poi: NarrativePoi): string {
  return `${poi.lon.toFixed(6)}:${poi.lat.toFixed(6)}:${poi.tier}`
}

function hasRenderablePoiEvidence(region: NarrativeRegion): boolean {
  const evidencePoints = region.visual_layer.poi_heat?.points
    .filter((point) => point.tier === 'core' || point.tier === 'strong' || point.tier === 'medium') ?? []
  const uniquePointKeys = new Set(evidencePoints.map((point) => `${point.lon.toFixed(5)}:${point.lat.toFixed(5)}`))
  return uniquePointKeys.size >= 3
}

function stableSortPois(pois: NarrativePoi[]): NarrativePoi[] {
  return [...pois].sort((left, right) =>
    TIER_ORDER[left.tier] - TIER_ORDER[right.tier]
      || left.display_name.localeCompare(right.display_name, 'zh-CN')
      || left.id.localeCompare(right.id)
  )
}

function dedupePois(pois: NarrativePoi[]): NarrativePoi[] {
  const map = new Map<string, NarrativePoi>()
  for (const poi of pois) {
    if (poi.tier === 'excluded') continue
    const key = poiKey(poi)
    if (!map.has(key)) map.set(key, poi)
  }
  return stableSortPois([...map.values()])
}

function stabilizeRegion(region: NarrativeRegion): NarrativeRegion {
  const currentPois = dedupePois(region.pois).filter((poi) => pointInRegionBoundary(poi, region))
  const pois = currentPois.slice(0, 240)
  const evidencePois = pois.filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium')
  const heatPois = evidencePois.length > 0 ? evidencePois : pois.filter((poi) => poi.tier === 'weak').slice(0, 80)
  return {
    ...region,
    pois,
    visual_layer: {
      ...region.visual_layer,
      poi_heat: {
        radius: region.visual_layer.poi_heat?.radius ?? 24,
        points: heatPois.map((poi) => ({ lon: poi.lon, lat: poi.lat, tier: poi.tier }))
      }
    }
  }
}

export function adaptNarrativeResponse(response: NarrativeResponse, renderablePois?: NarrativePoi[]): NarrativeDisplayModel {
  const regionAlias = new Map<string, string>()
  const regionKeyToId = new Map<string, string>()
  const uniqueRegions: NarrativeRegion[] = []
  for (const region of response.regions) {
    if (!isUsableRegionName(region.display_name)) continue
    const key = normalizeRegionKey(region.display_name) || region.id
    const existingId = regionKeyToId.get(key)
    if (existingId) {
      regionAlias.set(region.id, existingId)
    } else {
      regionKeyToId.set(key, region.id)
      regionAlias.set(region.id, region.id)
      uniqueRegions.push(region)
    }
  }
  const chapterByRegionId = new Map<string, NarrativeChapter>()
  for (const chapter of response.narration.chapters) {
    const regionId = regionAlias.get(chapter.region_id) ?? chapter.region_id
    if (!chapterByRegionId.has(regionId)) {
      chapterByRegionId.set(regionId, { ...chapter, region_id: regionId })
    }
  }

  const pathPairs: Array<{ node: NarrativePathNode; chapter: NarrativeChapter }> = []
  const seenPathKeys = new Set<string>()
  for (const [index, node] of response.path.nodes.entries()) {
    const regionId = regionAlias.get(node.region_id) ?? node.region_id
    const region = uniqueRegions.find((item) => item.id === regionId)
    if (!region) continue
    const pathKey = normalizeRegionKey(region?.display_name ?? regionId) || regionId
    if (seenPathKeys.has(pathKey)) continue
    seenPathKeys.add(pathKey)
    const matchedChapter = chapterByRegionId.get(regionId) ?? response.narration.chapters[index]
    pathPairs.push({
      node: { ...node, region_id: regionId },
      chapter: {
        region_id: regionId,
        text: matchedChapter?.text ?? `${region?.display_name ?? regionId}是当前解说路径中的一站。`,
        web_source: matchedChapter?.web_source,
        web_sources: matchedChapter?.web_sources,
        length_ms: matchedChapter?.length_ms
      }
    })
  }

  const stableRegions = uniqueRegions
    .map((region) => renderablePois ? region : stabilizeRegion(region))
    .filter(hasRenderablePoiEvidence)
  const pathRoleByRegion = new Map(pathPairs.map(({ node }) => [node.region_id, node.narration_role]))
  const regions = stableRegions.map<NarrativeDisplayRegion>((region) => ({
    ...region,
    chapter_label: labelForNarrationRole(pathRoleByRegion.get(region.id) ?? 'related')
  }))
  const regionMap = Object.fromEntries(regions.map((region) => [region.id, region]))
  const displayPathPairs = pathPairs.filter(({ node }) => regionMap[node.region_id])
  const pathNodes = displayPathPairs.map<NarrativeDisplayPathNode>(({ node }) => {
    const region = regionMap[node.region_id]
    return {
      ...node,
      chapter_label: labelForNarrationRole(node.narration_role),
      display_name: region?.display_name ?? node.region_id
    }
  })
  const allRenderablePois = renderablePois ?? regions.flatMap((region) => region.pois)
  const tierStats = computeTierStats(allRenderablePois)
  return {
    response,
    regions,
    regionMap,
    pathNodes,
    chapters: displayPathPairs.map(({ chapter }) => chapter),
    allRenderablePois,
    tierStats
  }
}

export function computeTierStats(pois: NarrativePoi[]): TierStats {
  const stats: TierStats = { core: 0, strong: 0, medium: 0, weak: 0, excluded: 0 }
  for (const poi of pois) stats[poi.tier] += 1
  return stats
}
