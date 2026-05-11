import type { NarrativeExplorationControls, NarrationTone, UserContext } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'

export type ExplorationFocus = 'comprehensive' | 'commerce' | 'nightlife' | 'memory' | 'family' | 'education' | 'commute' | 'tourism'

const NARRATION_CATEGORY_FORBIDDEN_RE = /(商务住宅|住宅区|住宅|小区|宿舍|家属区|楼栋|单元|服务中心|售楼|营销中心|医院|医疗|党校|住宿服务|摩托车服务|汽车服务|汽车维修|汽车销售|汽车配件|公司企业|道路附属设施|通行设施|室内设施|未分类)/u

export function resolveExplorationFocus(userContext: UserContext | undefined, tone: NarrationTone, controls?: NarrativeExplorationControls): ExplorationFocus {
  if (isExplorationFocus(controls?.theme)) return controls.theme
  const label = `${userContext?.preference_label || ''} ${userContext?.history_label || ''}`
  if (/夜生活|夜市|晚间|烟火气/u.test(label)) return 'nightlife'
  if (/商业活力|消费锚点|商圈层级|餐饮休闲/u.test(label)) return 'commerce'
  if (/城市记忆|历史街巷|老地名|人文线索/u.test(label)) return 'memory'
  if (/亲子休闲|公园绿地|公共服务|步行友好/u.test(label)) return 'family'
  if (/高校科教|校园文化|知识社区/u.test(label)) return 'education'
  if (/通勤生活|交通节点|日常便利|社区服务/u.test(label)) return 'commute'
  if (/文旅打卡|地标景点|游览动线|城市名片/u.test(label)) return 'tourism'
  if (tone === 'humanity') return 'memory'
  if (tone === 'tour') return 'tourism'
  return 'comprehensive'
}

function isExplorationFocus(value: unknown): value is ExplorationFocus {
  return value === 'comprehensive'
    || value === 'commerce'
    || value === 'nightlife'
    || value === 'memory'
    || value === 'family'
    || value === 'education'
    || value === 'commute'
    || value === 'tourism'
}

export function focusLabel(focus: ExplorationFocus): string {
  switch (focus) {
    case 'commerce': return '商业活力'
    case 'nightlife': return '夜生活'
    case 'memory': return '城市记忆'
    case 'family': return '亲子休闲'
    case 'education': return '高校科教'
    case 'commute': return '通勤生活'
    case 'tourism': return '文旅游览'
    case 'comprehensive': return '综合观察'
  }
}

export function focusSearchHints(focus: ExplorationFocus): string[] {
  switch (focus) {
    case 'commerce': return ['商业活力 消费 商圈 餐饮 购物', '逛街 美食 推荐']
    case 'nightlife': return ['夜生活 夜市 宵夜 酒吧 晚间消费', '晚上 好去处 美食']
    case 'memory': return ['历史文化 老街 老地名 人文', '历史沿革 城市记忆']
    case 'family': return ['亲子 公园 休闲 步行 游玩', '适合带娃 公共空间']
    case 'education': return ['高校 科教 校园文化 书店', '大学 周边 知识社区']
    case 'commute': return ['地铁 公交 交通 换乘 到达', '通勤 交通节点 日常便利']
    case 'tourism': return ['旅游 攻略 打卡 景点 游玩', '文旅 地标 城市名片']
    case 'comprehensive': return []
  }
}

export function themeRelevantCategories(region: RegionCandidate, focus: ExplorationFocus): string[] {
  const categories = [...new Set(region.pois
    .filter((poi) => poi.tier !== 'excluded')
    .map((poi) => poi.category_main || '')
    .filter(isNarrationCategoryAllowed))]
  const preferred = categories.filter((category) => categoryMatchesFocus(category, focus))
  return (preferred.length > 0 ? preferred : categories).slice(0, 3)
}

export function regionExplorationFocusScore(region: RegionCandidate, focus: ExplorationFocus): number {
  if (focus === 'comprehensive') return 0
  const text = regionFocusText(region)
  const matchedCategoryCount = region.pois
    .filter((poi) => poi.tier !== 'excluded')
    .filter((poi) => isNarrationCategoryAllowed(poi.category_main || '') && categoryMatchesFocus(poi.category_main || '', focus))
    .length
  const categoryScore = Math.min(0.35, matchedCategoryCount * categoryFocusWeight(focus))
  const tagScore = storyTagFocusScore(region, focus)
  const hardScore = hardEvidenceScore(text, focus)
  const textScore = textMatchesFocus(text, focus) ? textFocusWeight(focus) : 0
  return Math.min(1, hardScore + textScore + tagScore + categoryScore)
}

function isNarrationCategoryAllowed(category: string): boolean {
  return Boolean(category) && !NARRATION_CATEGORY_FORBIDDEN_RE.test(category)
}

function regionFocusText(region: RegionCandidate): string {
  return [
    region.display_name,
    ...(region.story_tags || []),
    ...region.pois
      .filter((poi) => poi.tier !== 'excluded')
      .map((poi) => `${poi.display_name} ${poi.category_main || ''} ${poi.category_sub || ''}`),
  ].join(' ')
}

function storyTagFocusScore(region: RegionCandidate, focus: ExplorationFocus): number {
  const tags = new Set(region.story_tags || [])
  switch (focus) {
    case 'commerce': return tags.has('commerce') || tags.has('food') || tags.has('market') ? 0.25 : 0
    case 'nightlife': return tags.has('nightlife') || tags.has('market') || tags.has('food') ? 0.25 : 0
    case 'memory': return tags.has('heritage') || tags.has('culture') ? 0.25 : 0
    case 'family': return Math.min(0.3, (tags.has('ecology') ? 0.26 : 0) + (tags.has('community') ? 0.06 : 0) + (tags.has('leisure') ? 0.06 : 0))
    case 'education': return tags.has('education') || tags.has('culture') ? 0.25 : 0
    case 'commute': return Math.min(0.3, (tags.has('transit') ? 0.28 : 0) + (tags.has('community') ? 0.06 : 0))
    case 'tourism': return Math.min(0.3, (tags.has('landmark') ? 0.18 : 0) + (tags.has('heritage') ? 0.18 : 0) + (tags.has('ecology') ? 0.14 : 0) + (tags.has('leisure') ? 0.05 : 0))
    case 'comprehensive': return 0
  }
}

function categoryFocusWeight(focus: ExplorationFocus): number {
  switch (focus) {
    case 'family': return 0.08
    case 'tourism': return 0.1
    case 'commute': return 0.14
    default: return 0.12
  }
}

function textFocusWeight(focus: ExplorationFocus): number {
  switch (focus) {
    case 'family':
    case 'tourism':
    case 'commute':
      return 0.22
    default:
      return 0.55
  }
}

function hardEvidenceScore(text: string, focus: ExplorationFocus): number {
  switch (focus) {
    case 'family':
      return /(公园|绿地|亲子|儿童|游乐|东湖|沙湖|湖岸|湖滨|江滩|景区|风景名胜)/u.test(text) ? 0.42 : 0
    case 'commute':
      return /(地铁|公交|车站|站点|换乘|枢纽|出入口|码头|渡口|火车站|交通设施|停车场|轨道交通)/u.test(text) ? 0.48 : 0
    case 'tourism':
      return /(景区|景点|步行街|江滩|博物馆|纪念馆|黄鹤楼|东湖|沙湖|磨山|地标|文旅|旅游|游客|打卡)/u.test(text) ? 0.42 : 0
    default:
      return 0
  }
}

function textMatchesFocus(text: string, focus: ExplorationFocus): boolean {
  switch (focus) {
    case 'commerce': return /(购物|餐饮|商业|商圈|消费|商场|万象|销品茂|万象汇|休闲|娱乐)/u.test(text)
    case 'nightlife': return /(夜市|夜生活|晚间|烟火|餐饮|美食|小吃|酒吧|宵夜|娱乐)/u.test(text)
    case 'memory': return /(文化|历史|博物馆|纪念|老街|街巷|古迹|旧址|人文)/u.test(text)
    case 'family': return /(公园|绿地|亲子|儿童|游乐|东湖|沙湖|湖岸|湖滨|江滩|景区|风景名胜)/u.test(text)
    case 'education': return /(大学|学院|学校|科教|文化|图书|书店|校园|学习)/u.test(text)
    case 'commute': return /(地铁|公交|停车|道路|车站|站点|换乘|枢纽|出入口|交通设施|轨道交通)/u.test(text)
    case 'tourism': return /(风景|景区|公园|地标|游客|游览|江滩|东湖|沙湖|磨山|步行街|博物馆|纪念馆|黄鹤楼)/u.test(text)
    case 'comprehensive': return false
  }
}

function categoryMatchesFocus(category: string, focus: ExplorationFocus): boolean {
  switch (focus) {
    case 'commerce': return /(购物|餐饮|商业服务)/u.test(category)
    case 'nightlife': return /(餐饮|体育休闲)/u.test(category)
    case 'memory': return /(科教文化|风景名胜|购物|餐饮)/u.test(category)
    case 'family': return /(风景名胜|科教文化|公共设施)/u.test(category)
    case 'education': return /(科教文化|生活服务|购物|体育休闲)/u.test(category)
    case 'commute': return /(交通设施|公共设施)/u.test(category)
    case 'tourism': return /(风景名胜|科教文化|体育休闲)/u.test(category)
    case 'comprehensive': return true
  }
}
