import type {
  AreaHotspot,
  AreaInsightSignal,
  AreaProfile,
  AreaProfileCategory,
  EvidenceItem,
} from '../../chat/types.js'

const LOW_SIGNAL_CATEGORY_KEYWORDS: string[] = [
  '地名地址信息',
  '未分类',
  '楼栋',
  '楼栋号',
  '门牌',
  '门牌号',
  '停车场出入口',
  '出入口',
  '通道',
  '门卫',
  '物业',
  '道路名',
  '路口名',
  '站口',
  '共享充电宝',
  '共享充电',
]

const LIVELIHOOD_PRIMARY_FALLBACK = '其他'

const LIVELIHOOD_PRIMARY_RULES: Array<{ label: string, keywords: string[] }> = [
  { label: '学习', keywords: ['教育', '学校', '大学', '学院', '培训', '图书馆', '科研', '校园', '科教文化'] },
  { label: '医疗', keywords: ['医疗', '医院', '诊所', '药店', '卫生', '门诊', '体检', '急救'] },
  { label: '食', keywords: ['餐饮', '美食', '小吃', '咖啡', '茶饮', '饮品', '餐厅', '甜品', '面包'] },
  { label: '住', keywords: ['住宅', '小区', '公寓', '宿舍', '酒店', '宾馆', '民宿', '住宿', '租赁'] },
  { label: '购', keywords: ['购物', '商场', '百货', '超市', '便利店', '零售', '服装', '箱包', '珠宝', '饰品'] },
  { label: '行', keywords: ['交通', '地铁', '公交', '停车', '出入口', '道路', '共享充电', '充电宝', '充电桩', '共享单车', '出行', '交通设施'] },
  { label: '闲', keywords: ['体育', '休闲', '娱乐', '健身', '公园', '景区', '电影院', 'ktv', '酒吧', '网吧'] },
  { label: '生活', keywords: ['生活服务', '便民', '家政', '洗衣', '美容', '理发', '维修', '快递', '打印', '宠物'] },
]

type WeightedCategory = {
  label: string
  count: number
}

function toShare(count: number, total: number) {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) {
    return 0
  }
  return count / total
}

function normalizeCategoryText(value: unknown) {
  return String(value || '').trim()
}

function normalizePrimaryText(label: string) {
  const mapping: Record<string, string> = {
    学习: '学习型内容',
    医疗: '医疗型服务',
    食: '餐饮型内容',
    住: '停留型服务',
    购: '零售型内容',
    行: '出行型内容',
    闲: '休闲型内容',
    生活: '日常生活服务',
    其他: '混合型内容',
  }
  return mapping[label] || `${label}型内容`
}

function humanizeSecondaryFocus(label: string) {
  const normalized = String(label || '').trim()
  const aliasMap: Record<string, string> = {
    大学: '校园',
    学校: '校园',
    校园: '校园',
    地铁站: '地铁接驳',
    地铁口: '地铁接驳',
    便利店: '便利零售',
    中餐厅: '餐饮',
    咖啡: '咖啡消费',
  }

  return aliasMap[normalized] || normalized
}

function sortWeightedCategories(entries: WeightedCategory[]) {
  return [...entries]
    .sort((left, right) => right.count - left.count)
}

function toAreaProfileCategories(entries: WeightedCategory[], total: number): AreaProfileCategory[] {
  return sortWeightedCategories(entries)
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      share: Number(toShare(entry.count, total).toFixed(4)),
    }))
}

function incrementCounter(counter: Map<string, number>, label: string, count: number) {
  if (!label || !Number.isFinite(count) || count <= 0) return
  counter.set(label, (counter.get(label) || 0) + count)
}

function mapToWeightedCategories(counter: Map<string, number>) {
  return Array.from(counter.entries()).map(([label, count]) => ({ label, count }))
}

function readRingFootfall(rows: Record<string, unknown>[] = []) {
  const normalized = rows
    .map((row) => ({
      label: String(row.ring_label || row.label || '').trim(),
      order: Number(row.ring_order || row.order || 0),
      count: Number(row.poi_count || row.count || 0),
    }))
    .filter((row) => row.label && Number.isFinite(row.count) && row.count > 0)
    .sort((left, right) => left.order - right.order)

  const total = normalized.reduce((sum, row) => sum + row.count, 0)
  return normalized.map((row) => ({
    label: row.label,
    count: row.count,
    share: Number(toShare(row.count, total).toFixed(4)),
  }))
}

function itemCategoryLabel(item: EvidenceItem) {
  return normalizeCategoryText(item.categorySub || item.categoryMain || item.category)
}

function itemMainCategoryLabel(item: EvidenceItem) {
  return normalizeCategoryText(item.categoryMain || item.category || item.categorySub)
}

export function isLowSignalCategoryName(category: unknown) {
  const normalized = normalizeCategoryText(category).toLowerCase()
  if (!normalized) return true
  return LOW_SIGNAL_CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

export function resolveLivelihoodPrimaryCategory(input: {
  categoryMain?: unknown
  categorySub?: unknown
  category?: unknown
}) {
  const merged = [
    normalizeCategoryText(input.categorySub),
    normalizeCategoryText(input.categoryMain),
    normalizeCategoryText(input.category),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!merged) {
    return LIVELIHOOD_PRIMARY_FALLBACK
  }

  for (const rule of LIVELIHOOD_PRIMARY_RULES) {
    if (rule.keywords.some((keyword) => merged.includes(keyword.toLowerCase()))) {
      return rule.label
    }
  }

  return LIVELIHOOD_PRIMARY_FALLBACK
}

function buildCategoryBreakdown(input: {
  items: EvidenceItem[]
  buckets: Array<{ label: string, value: number }>
}) {
  if (input.buckets.length > 0) {
    return input.buckets
      .filter((bucket) => bucket.label && Number.isFinite(bucket.value) && bucket.value > 0)
      .map((bucket) => ({
        label: bucket.label,
        count: bucket.value,
      }))
  }

  const counter = new Map<string, number>()
  for (const item of input.items) {
    incrementCounter(counter, itemMainCategoryLabel(item), 1)
  }
  return mapToWeightedCategories(counter)
}

function buildPrimaryRanking(input: {
  items: EvidenceItem[]
  categoryBreakdown: WeightedCategory[]
  useBucketEvidence: boolean
}) {
  const preferredCounter = new Map<string, number>()
  const fallbackCounter = new Map<string, number>()
  let lowSignalCount = 0

  if (!input.useBucketEvidence && input.items.length > 0) {
    for (const item of input.items) {
      const categoryLabel = itemCategoryLabel(item)
      const primary = resolveLivelihoodPrimaryCategory({
        categoryMain: item.categoryMain,
        categorySub: item.categorySub,
        category: item.category,
      })
      incrementCounter(fallbackCounter, primary, 1)
      if (isLowSignalCategoryName(categoryLabel)) {
        lowSignalCount += 1
        continue
      }
      incrementCounter(preferredCounter, primary, 1)
    }
  } else {
    for (const category of input.categoryBreakdown) {
      const primary = resolveLivelihoodPrimaryCategory({
        categoryMain: category.label,
        categorySub: category.label,
        category: category.label,
      })
      incrementCounter(fallbackCounter, primary, category.count)
      if (isLowSignalCategoryName(category.label)) {
        lowSignalCount += category.count
        continue
      }
      incrementCounter(preferredCounter, primary, category.count)
    }
  }

  const activeCounter = preferredCounter.size > 0 ? preferredCounter : fallbackCounter
  const preferredPrimary = sortWeightedCategories(mapToWeightedCategories(preferredCounter))[0]?.label || null

  return {
    primaryCategories: toAreaProfileCategories(
      mapToWeightedCategories(activeCounter),
      input.categoryBreakdown.reduce((sum, item) => sum + item.count, 0),
    ),
    preferredPrimaryCategory: preferredPrimary,
    lowSignalCount,
  }
}

function buildSecondaryRanking(items: EvidenceItem[], categoryBreakdown: WeightedCategory[]) {
  const preferredCounter = new Map<string, number>()
  const fallbackCounter = new Map<string, number>()

  if (items.length > 0) {
    for (const item of items) {
      const label = itemCategoryLabel(item)
      incrementCounter(fallbackCounter, label, 1)
      if (isLowSignalCategoryName(label)) {
        continue
      }
      incrementCounter(preferredCounter, label, 1)
    }
  } else {
    for (const category of categoryBreakdown) {
      incrementCounter(fallbackCounter, category.label, category.count)
      if (isLowSignalCategoryName(category.label)) {
        continue
      }
      incrementCounter(preferredCounter, category.label, category.count)
    }
  }

  const activeCounter = preferredCounter.size > 0 ? preferredCounter : fallbackCounter
  const total = Array.from(activeCounter.values()).reduce((sum, count) => sum + count, 0)
  return toAreaProfileCategories(mapToWeightedCategories(activeCounter), total)
}

function pickDominantPrimary(primaryCategories: AreaProfileCategory[], totalCount: number) {
  const topPrimary = primaryCategories[0]
  if (!topPrimary) return null

  if (topPrimary.label !== LIVELIHOOD_PRIMARY_FALLBACK) {
    return topPrimary
  }

  const secondaryPrimary = primaryCategories[1]
  if (secondaryPrimary && secondaryPrimary.count >= Math.max(2, Math.round(totalCount * 0.2))) {
    return secondaryPrimary
  }

  return topPrimary
}

export function buildLivelihoodProfile(input: {
  items: EvidenceItem[]
  buckets?: Array<{ label: string, value: number }>
  ringDistribution?: Record<string, unknown>[]
}): AreaProfile | undefined {
  const buckets = input.buckets || []
  const categoryBreakdown = buildCategoryBreakdown({
    items: input.items,
    buckets,
  })

  if (categoryBreakdown.length === 0) {
    return undefined
  }

  const totalCount = categoryBreakdown.reduce((sum, item) => sum + item.count, 0)
  const primaryRanking = buildPrimaryRanking({
    items: input.items,
    categoryBreakdown,
    useBucketEvidence: buckets.length > 0,
  })
  const secondaryTop = buildSecondaryRanking(input.items, categoryBreakdown).slice(0, 3)
  const dominantCategories = toAreaProfileCategories(categoryBreakdown, totalCount).slice(0, 3)
  const dominantPrimary = pickDominantPrimary(primaryRanking.primaryCategories, totalCount)

  return {
    totalCount,
    dominantCategories,
    preferredPrimaryCategory: primaryRanking.preferredPrimaryCategory,
    dominantPrimary,
    primaryCategories: primaryRanking.primaryCategories.slice(0, 7),
    dominantSecondary: secondaryTop[0] || null,
    secondaryTop,
    lowSignalRatio: Number(toShare(primaryRanking.lowSignalCount, totalCount).toFixed(4)),
    lowSignalCount: primaryRanking.lowSignalCount,
    ringFootfall: readRingFootfall(input.ringDistribution),
    rankingApplied: primaryRanking.primaryCategories.length > 0,
  }
}

export function buildAnomalySignals(profile?: AreaProfile, hotspots: AreaHotspot[] = []): AreaInsightSignal[] {
  if (!profile) return []

  const signals: AreaInsightSignal[] = []
  const dominantPrimary = profile.dominantPrimary
  const dominantCategory = profile.dominantCategories[0]
  const firstRing = profile.ringFootfall[0]

  if ((dominantPrimary?.share || dominantCategory?.share || 0) >= 0.55) {
    const focusLabel = dominantPrimary?.label || dominantCategory?.label || '头部业态'
    const secondaryLabel = profile.dominantSecondary?.label
    signals.push({
      kind: 'mono_structure_risk',
      title: '结构明显偏单一',
      detail: secondaryLabel
        ? `${normalizePrimaryText(focusLabel)}占比约 ${Math.round((dominantPrimary?.share || dominantCategory?.share || 0) * 100)}%，次级抓手更多围绕${humanizeSecondaryFocus(secondaryLabel)}，片区结构仍然比较单核。`
        : `${normalizePrimaryText(focusLabel)}占比约 ${Math.round((dominantPrimary?.share || dominantCategory?.share || 0) * 100)}%，片区结构已经明显偏向单一头部业态。`,
      score: Number(Math.min(dominantPrimary?.share || dominantCategory?.share || 0, 0.92).toFixed(2)),
    })
  }

  if (firstRing && firstRing.share >= 0.45) {
    signals.push({
      kind: 'core_cluster_risk',
      title: '活力过度集中在核心圈层',
      detail: `${firstRing.label} 内聚集了约 ${Math.round(firstRing.share * 100)}% 的样本，片区活力更像单核集聚，而不是均匀铺开。`,
      score: Number(Math.min(firstRing.share, 0.88).toFixed(2)),
    })
  }

  if (profile.lowSignalRatio >= 0.25) {
    signals.push({
      kind: 'low_signal_warning',
      title: '低信号样本偏多',
      detail: `低信号类别占比约 ${Math.round(profile.lowSignalRatio * 100)}%，说明片区判断要防止被出入口、门牌这类噪声样本带偏。`,
      score: Number(Math.min(profile.lowSignalRatio, 0.78).toFixed(2)),
    })
  }

  if (!signals.length && hotspots[0]?.poiCount >= 8) {
    signals.push({
      kind: 'hotspot_density',
      title: '热点密度偏高',
      detail: `头部热点网格内已聚集 ${hotspots[0].poiCount} 个点位，说明活力与竞争都更容易挤在同一小片范围。`,
      score: 0.58,
    })
  }

  return signals.slice(0, 3)
}
