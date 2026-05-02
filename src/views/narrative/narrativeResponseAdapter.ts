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

const stableRegionPois = new Map<string, NarrativePoi[]>()
const TIER_ORDER: Record<NarrativePoi['tier'], number> = {
  core: 0,
  strong: 1,
  medium: 2,
  weak: 3,
  excluded: 4
}

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

function visualHeatPoisForRegion(region: NarrativeRegion): NarrativePoi[] {
  const points = region.visual_layer.poi_heat?.points ?? []
  return points.map((point, index) => ({
    id: `heat-${region.id}-${index}`,
    lon: point.lon,
    lat: point.lat,
    display_name: region.display_name,
    tier: point.tier,
    role: region.role,
    category_main: region.display_name
  }))
}

function poiKey(poi: NarrativePoi): string {
  return `${poi.lon.toFixed(6)}:${poi.lat.toFixed(6)}:${poi.tier}`
}

function evidenceCount(pois: NarrativePoi[]): number {
  return pois.filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium').length
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
  const key = normalizeRegionKey(region.display_name) || region.id
  const currentPois = dedupePois([...region.pois, ...visualHeatPoisForRegion(region)])
  const cachedPois = stableRegionPois.get(key) ?? []
  const stablePois = evidenceCount(currentPois) >= evidenceCount(cachedPois) ? currentPois : cachedPois
  if (stablePois.length > 0) stableRegionPois.set(key, stablePois.slice(0, 240))
  const pois = (stableRegionPois.get(key) ?? stablePois).slice(0, 240)
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

  const pathPairs: Array<{ node: NarrativePathNode; chapter: NarrativeChapter }> = []
  const seenPathKeys = new Set<string>()
  for (const [index, node] of response.path.nodes.entries()) {
    const regionId = regionAlias.get(node.region_id) ?? node.region_id
    const region = uniqueRegions.find((item) => item.id === regionId)
    const pathKey = normalizeRegionKey(region?.display_name ?? regionId) || regionId
    if (seenPathKeys.has(pathKey)) continue
    seenPathKeys.add(pathKey)
    pathPairs.push({
      node: { ...node, region_id: regionId },
      chapter: {
        region_id: regionId,
        text: response.narration.chapters[index]?.text ?? `${region?.display_name ?? regionId}是当前解说路径中的一站。`,
        web_source: response.narration.chapters[index]?.web_source,
        web_sources: response.narration.chapters[index]?.web_sources,
        length_ms: response.narration.chapters[index]?.length_ms
      }
    })
  }

  const stableRegions = uniqueRegions.map((region) => renderablePois ? region : stabilizeRegion(region))
  const pathRoleByRegion = new Map(pathPairs.map(({ node }) => [node.region_id, node.narration_role]))
  const regions = stableRegions.map<NarrativeDisplayRegion>((region) => ({
    ...region,
    chapter_label: labelForNarrationRole(pathRoleByRegion.get(region.id) ?? 'related')
  }))
  const regionMap = Object.fromEntries(regions.map((region) => [region.id, region]))
  const pathNodes = pathPairs.map<NarrativeDisplayPathNode>(({ node }) => {
    const region = regionMap[node.region_id]
    return {
      ...node,
      chapter_label: labelForNarrationRole(node.narration_role),
      display_name: region?.display_name ?? node.region_id
    }
  })
  const allRenderablePois = renderablePois ?? regions.flatMap((region) => region.pois.length > 0 ? region.pois : visualHeatPoisForRegion(region))
  const tierStats = computeTierStats(allRenderablePois)
  return {
    response,
    regions,
    regionMap,
    pathNodes,
    chapters: pathPairs.map(({ chapter }) => chapter),
    allRenderablePois,
    tierStats
  }
}

export function computeTierStats(pois: NarrativePoi[]): TierStats {
  const stats: TierStats = { core: 0, strong: 0, medium: 0, weak: 0, excluded: 0 }
  for (const poi of pois) stats[poi.tier] += 1
  return stats
}
