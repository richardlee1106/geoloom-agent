import type { LODLevel, NarrativePoi, NarrativeRegion, NarrativeRouteStrategy, SceneProfile, StoryTag } from './contract.js'
import type { RegionRelationType } from './regionRelations.js'

const STORY_TAG_ORDER: StoryTag[] = [
  'campus',
  'education',
  'culture',
  'heritage',
  'food',
  'nightlife',
  'commerce',
  'market',
  'ecology',
  'waterfront',
  'transit',
  'community',
  'landmark',
  'leisure',
  'urban_life',
]

const TAG_RULES: Array<{ tag: StoryTag; re: RegExp }> = [
  { tag: 'campus', re: /(大学|学院|校区|校园|university|college|campus)/iu },
  { tag: 'education', re: /(科教|教育|学校|中学|小学|幼儿园|图书馆|教学|实验室|研究院|研究所|书院)/iu },
  { tag: 'culture', re: /(文化|博物馆|美术馆|艺术馆|科技馆|展览|剧院|礼堂|书店|书局|艺术|非遗)/iu },
  { tag: 'heritage', re: /(历史|古迹|旧址|纪念馆|纪念碑|故居|老街|古城|黄鹤楼|黎黄陂|昙华林|汉正街|胜利街|山海关路)/iu },
  { tag: 'food', re: /(餐饮|美食|小吃|餐厅|饭店|酒楼|火锅|烧烤|咖啡|茶|饮品|面馆|粉面|包子|汽水包|鸡冠饺|宵夜)/iu },
  { tag: 'nightlife', re: /(夜市|酒吧|宵夜|夜宵|保成路|大成路|虎泉|吉庆街|台北路)/iu },
  { tag: 'commerce', re: /(商业|购物|商圈|步行街|商业街|商场|广场|购物中心|万达|万象|汉街|天地|销品茂|K11|SKP|mall|plaza)/iu },
  { tag: 'market', re: /(市场|菜场|集市|批发|农贸|汉正街|水塔街)/iu },
  { tag: 'ecology', re: /(生态|自然|公园|绿地|湿地|湖|山|景区|风景|绿道|草坪|森林)/iu },
  { tag: 'waterfront', re: /(江滩|江|河|湖|滨水|水岸|码头|渡口|岸线|堤|滩)/iu },
  { tag: 'transit', re: /(地铁|公交|车站|站口|出入口|交通|火车站|机场|码头|渡口|客运)/iu },
  { tag: 'community', re: /(社区|街道|生活服务|便民|菜场|市场|邻里|居民|卫生服务|政务|银行|超市|便利店)/iu },
  { tag: 'landmark', re: /(地标|景点|景区|广场|塔|楼|桥|中心|馆|门|城|纪念)/iu },
  { tag: 'leisure', re: /(休闲|娱乐|影院|影城|体育|健身|游乐|酒店|民宿|茶馆|咖啡|公园)/iu },
  { tag: 'urban_life', re: /(街|路|巷|坊|里|城|片区|城区|商住|生活|服务)/iu },
]

export function inferPoiStoryTags(input: Pick<NarrativePoi, 'display_name' | 'category_main' | 'category_sub'>): StoryTag[] {
  return tagsFromText(`${input.display_name} ${input.category_main || ''} ${input.category_sub || ''}`)
}

export function inferRegionStoryTags(input: {
  display_name: string
  role?: NarrativeRegion['role']
  scene?: SceneProfile
  source?: string
  pois?: NarrativePoi[]
}): StoryTag[] {
  const scores = new Map<StoryTag, number>()
  addWeightedTags(scores, tagsFromText(input.display_name), 3)
  addWeightedTags(scores, sceneStoryTags(input.scene), 1.4)
  if (input.role === 'landmark_anchor') addScore(scores, 'landmark', 1.2)
  if (input.source === 'abstract_region') addScore(scores, 'urban_life', 0.7)
  for (const poi of input.pois || []) {
    const tags = poi.story_tags?.length ? poi.story_tags : inferPoiStoryTags(poi)
    const weight = poi.tier === 'core' || poi.tier === 'strong' ? 1 : poi.tier === 'medium' ? 0.7 : 0.25
    addWeightedTags(scores, tags, weight)
  }
  if (scores.size === 0) addWeightedTags(scores, sceneStoryTags(input.scene), 1)
  if (scores.size === 0) addScore(scores, 'urban_life', 1)
  return sortScoredTags(scores, 5)
}

export function inferPathStoryTags(regions: Array<Pick<NarrativeRegion, 'story_tags' | 'pois' | 'display_name' | 'role'>>): StoryTag[] {
  const scores = new Map<StoryTag, number>()
  regions.forEach((region, index) => {
    const tags = region.story_tags?.length ? region.story_tags : inferRegionStoryTags({ display_name: region.display_name, role: region.role, pois: region.pois })
    addWeightedTags(scores, tags, index === 0 ? 1.5 : 1)
  })
  return sortScoredTags(scores, 7)
}

export function chooseRouteStrategy(
  regions: Array<Pick<NarrativeRegion, 'story_tags' | 'pois' | 'display_name' | 'role'>>,
  options: { lod?: LODLevel; relationTypes?: readonly RegionRelationType[] } = {},
): NarrativeRouteStrategy {
  const tags = new Set(inferPathStoryTags(regions))
  const relationTypes = new Set(options.relationTypes || [])
  const lod = options.lod
  if (tags.size === 0) return 'seeded_spatial_story'
  if (lod === 'macro' && (tags.size >= 5 || relationTypes.size >= 4)) return 'macro_city_cross_section'
  if (hasRelation(relationTypes, 'entrance_gateway') || tags.has('transit')) return 'transit_gateway_walk'
  if (hasRelation(relationTypes, 'campus_ecology_edge') || ((tags.has('campus') || tags.has('education')) && (tags.has('ecology') || tags.has('waterfront')))) return 'campus_ecology_walk'
  if (hasRelation(relationTypes, 'campus_life_support') || ((tags.has('campus') || tags.has('education')) && hasAnyTag(tags, 'food', 'commerce', 'community', 'urban_life'))) return 'campus_life_loop'
  if (hasRelation(relationTypes, 'market_street_life') || (tags.has('nightlife') && tags.has('market'))) return 'night_market_walk'
  if (hasRelation(relationTypes, 'commerce_food_synergy') || (hasAnyTag(tags, 'food', 'nightlife', 'market') && tags.has('commerce'))) return 'commercial_food_walk'
  if (hasRelation(relationTypes, 'heritage_modern') && tags.has('commerce')) return 'heritage_commerce_walk'
  if (hasRelation(relationTypes, 'culture_heritage_context') || tags.has('heritage') || tags.has('culture')) return 'heritage_culture_walk'
  if (hasRelation(relationTypes, 'waterfront_leisure_axis') || (tags.has('waterfront') && hasAnyTag(tags, 'leisure', 'commerce', 'food'))) return 'waterfront_leisure_walk'
  if (tags.has('waterfront') || tags.has('ecology')) return 'waterfront_ecology_walk'
  if (hasRelation(relationTypes, 'civic_service_support') || tags.has('community')) return 'civic_service_walk'
  if ((tags.has('campus') || tags.has('education')) && (tags.has('ecology') || tags.has('waterfront'))) return 'campus_ecology_walk'
  if ((tags.has('food') || tags.has('nightlife') || tags.has('market')) && tags.has('commerce')) return 'commercial_food_walk'
  if (tags.has('heritage') || tags.has('culture')) return 'heritage_culture_walk'
  if (tags.has('waterfront') || tags.has('ecology')) return 'waterfront_ecology_walk'
  if (tags.has('commerce') || tags.has('market')) return 'commercial_axis_walk'
  if (lod === 'micro') return 'micro_detail_walk'
  if (lod === 'meso') return 'meso_mixed_cluster_walk'
  if (lod === 'macro') return 'macro_city_cross_section'
  return 'mixed_discovery_walk'
}

function hasRelation(types: ReadonlySet<RegionRelationType>, type: RegionRelationType): boolean {
  return types.has(type)
}

function hasAnyTag(tags: ReadonlySet<StoryTag>, ...candidates: StoryTag[]): boolean {
  return candidates.some((tag) => tags.has(tag))
}

export function sharedStoryTags(left: Pick<NarrativeRegion, 'story_tags'>, right: Pick<NarrativeRegion, 'story_tags'>): StoryTag[] {
  const rightTags = new Set(right.story_tags || [])
  return (left.story_tags || []).filter((tag) => rightTags.has(tag))
}

export function storyTagPhrase(tags: readonly StoryTag[] | undefined, scene: SceneProfile): string {
  const set = new Set(tags || [])
  if (set.has('food') || set.has('nightlife')) return '这一段的烟火气和夜间消费线索更突出。'
  if (set.has('commerce') || set.has('market')) return '商业与步行消费活动在这里更集中。'
  if (set.has('campus') || set.has('education')) return '校园和学习文化给这里提供稳定底色。'
  if (set.has('ecology') || set.has('waterfront')) return '水岸与绿地让这一段的空间节奏更舒展。'
  if (set.has('heritage') || set.has('culture')) return '历史文化线索让这里更有时间层次。'
  if (set.has('transit')) return '交通节点让它和周边片区衔接更紧。'
  if (set.has('community')) return '日常生活配套让这里更接近本地人的使用方式。'
  if (scene === 'commercial_leisure') return '消费、休闲和街面活动共同塑造这里的城市气质。'
  if (scene === 'natural_ecology') return '开放空间和生态资源是这一段的主要线索。'
  if (scene === 'heritage_tourism') return '历史游览线索让这一段更适合慢慢展开。'
  if (scene === 'education_culture') return '教育文化资源是这一段解说的主要底色。'
  return '它体现了当前视野里的日常城市生活。'
}

export function countStoryTags(items: Array<{ story_tags?: StoryTag[] }>): Record<StoryTag, number> {
  const counts = new Map<StoryTag, number>()
  for (const item of items) addWeightedTags(counts, item.story_tags || [], 1)
  return Object.fromEntries(sortScoredTags(counts, STORY_TAG_ORDER.length).map((tag) => [tag, counts.get(tag) || 0])) as Record<StoryTag, number>
}

function tagsFromText(text: string): StoryTag[] {
  const out: StoryTag[] = []
  for (const rule of TAG_RULES) {
    if (rule.re.test(text)) out.push(rule.tag)
  }
  return rankTags(out, 5)
}

function sceneStoryTags(scene: SceneProfile | undefined): StoryTag[] {
  if (scene === 'education_culture') return ['education', 'culture']
  if (scene === 'heritage_tourism') return ['heritage', 'culture', 'landmark']
  if (scene === 'commercial_leisure') return ['commerce', 'food', 'leisure']
  if (scene === 'natural_ecology') return ['ecology', 'waterfront', 'leisure']
  if (scene === 'mixed_urban') return ['urban_life', 'community']
  return []
}

function addWeightedTags(scores: Map<StoryTag, number>, tags: readonly StoryTag[], weight: number): void {
  for (const tag of tags) addScore(scores, tag, weight)
}

function addScore(scores: Map<StoryTag, number>, tag: StoryTag, weight: number): void {
  scores.set(tag, (scores.get(tag) || 0) + weight)
}

function sortScoredTags(scores: Map<StoryTag, number>, limit: number): StoryTag[] {
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || STORY_TAG_ORDER.indexOf(left[0]) - STORY_TAG_ORDER.indexOf(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag)
}

function rankTags(tags: StoryTag[], limit: number): StoryTag[] {
  const scores = new Map<StoryTag, number>()
  addWeightedTags(scores, tags, 1)
  return sortScoredTags(scores, limit)
}
