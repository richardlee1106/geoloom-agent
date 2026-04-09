import type { AreaInsightSignal, AreaProfile } from '../../chat/types.js'

type CompetitionEntry = {
  label: string
  count: number
  avgDistance: number | null
}

const CATEGORY_ALIAS: Record<string, string> = {
  餐饮美食: '餐饮',
  购物服务: '零售配套',
  生活服务: '生活服务',
  交通设施服务: '交通接驳',
  科教文化服务: '教育文化',
  医疗保健服务: '医疗配套',
  体育休闲服务: '休闲活力',
  住宿服务: '停留配套',
}

const SCARCITY_PRIORITY_BY_PRIMARY: Record<string, string[]> = {
  学习: ['医疗保健服务', '体育休闲服务', '住宿服务'],
  医疗: ['生活服务', '餐饮美食', '购物服务'],
  食: ['生活服务', '住宿服务', '医疗保健服务'],
  住: ['生活服务', '餐饮美食', '购物服务'],
  购: ['生活服务', '餐饮美食', '体育休闲服务'],
  行: ['餐饮美食', '购物服务', '生活服务'],
  闲: ['餐饮美食', '生活服务', '购物服务'],
  生活: ['医疗保健服务', '体育休闲服务', '住宿服务'],
  其他: ['生活服务', '医疗保健服务', '体育休闲服务'],
}

const COMPLEMENTARY_PRIORITY_BY_PRIMARY: Record<string, string[]> = {
  学习: ['生活服务', '购物服务', '餐饮美食'],
  医疗: ['生活服务', '餐饮美食', '购物服务'],
  食: ['生活服务', '购物服务', '体育休闲服务'],
  住: ['生活服务', '餐饮美食', '购物服务'],
  购: ['生活服务', '餐饮美食', '体育休闲服务'],
  行: ['餐饮美食', '购物服务', '生活服务'],
  闲: ['餐饮美食', '生活服务', '购物服务'],
  生活: ['购物服务', '餐饮美食', '医疗保健服务'],
  其他: ['生活服务', '购物服务', '餐饮美食'],
}

function readNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function humanizeCategoryLabel(label: string) {
  return CATEGORY_ALIAS[label] || label
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

function parseCompetition(rows: Record<string, unknown>[] = []): CompetitionEntry[] {
  return rows
    .map((row) => ({
      label: String(row.competition_key || row.label || '').trim(),
      count: Number(row.poi_count || row.count || 0),
      avgDistance: readNumber(row.avg_distance_m),
    }))
    .filter((entry) => entry.label && Number.isFinite(entry.count) && entry.count > 0)
    .sort((left, right) => right.count - left.count)
}

function chooseMissingCategory(candidates: string[], dominantLabels: Set<string>, competitionMap: Map<string, CompetitionEntry>, exclude: Set<string>) {
  for (const candidate of candidates) {
    if (exclude.has(candidate)) continue
    if (dominantLabels.has(candidate)) continue
    const competition = competitionMap.get(candidate)
    if (!competition || competition.count <= 1) {
      return candidate
    }
  }
  return null
}

export function buildOpportunitySignals(input: {
  profile?: AreaProfile
  competitionDensity?: Record<string, unknown>[]
}): AreaInsightSignal[] {
  const profile = input.profile
  if (!profile) return []

  const signals: AreaInsightSignal[] = []
  const dominantPrimaryLabel = profile.dominantPrimary?.label || profile.preferredPrimaryCategory || '其他'
  const dominantPrimaryText = normalizePrimaryText(dominantPrimaryLabel)
  const dominantCategories = profile.dominantCategories || []
  const dominantLabels = new Set(dominantCategories.map((item) => item.label))
  const competitionEntries = parseCompetition(input.competitionDensity)
  const competitionMap = new Map(competitionEntries.map((entry) => [entry.label, entry]))
  const usedCategories = new Set<string>()

  const scarcityCategory = chooseMissingCategory(
    SCARCITY_PRIORITY_BY_PRIMARY[dominantPrimaryLabel] || SCARCITY_PRIORITY_BY_PRIMARY.其他,
    dominantLabels,
    competitionMap,
    usedCategories,
  )
  if (scarcityCategory) {
    usedCategories.add(scarcityCategory)
    signals.push({
      kind: 'scarcity_opportunity',
      title: `${humanizeCategoryLabel(scarcityCategory)}存在稀缺型机会`,
      detail: `${humanizeCategoryLabel(scarcityCategory)}还没进入当前头部结构，在竞争密度结果里也不突出，更像供给偏薄而不是已经卷起来的赛道。`,
      score: 0.68,
    })
  }

  const complementaryCategory = chooseMissingCategory(
    COMPLEMENTARY_PRIORITY_BY_PRIMARY[dominantPrimaryLabel] || COMPLEMENTARY_PRIORITY_BY_PRIMARY.其他,
    dominantLabels,
    competitionMap,
    usedCategories,
  )
  if (complementaryCategory) {
    usedCategories.add(complementaryCategory)
    signals.push({
      kind: 'complementary_service_gap',
      title: `${humanizeCategoryLabel(complementaryCategory)}补位价值更高`,
      detail: `片区当前更像由${dominantPrimaryText}牵引，但承接停留和日常转化的 ${humanizeCategoryLabel(complementaryCategory)} 还没跟上，更适合优先看互补型供给。`,
      score: 0.64,
    })
  }

  const topCompetition = competitionEntries[0]
  if (
    topCompetition
    && (
      topCompetition.count >= Math.max(8, Math.round(profile.totalCount * 0.35))
      || (
        topCompetition.avgDistance !== null
        && topCompetition.avgDistance <= 180
        && topCompetition.count >= Math.max(5, Math.round(profile.totalCount * 0.2))
      )
    )
  ) {
    signals.push({
      kind: 'over_competition_warning',
      title: `${humanizeCategoryLabel(topCompetition.label)}竞争已经很密`,
      detail: topCompetition.avgDistance !== null
        ? `${humanizeCategoryLabel(topCompetition.label)}是当前最密集的竞争层（${topCompetition.count} 个，平均间距约 ${Math.round(topCompetition.avgDistance)} 米），如果开同类门店，要非常警惕同质化。`
        : `${humanizeCategoryLabel(topCompetition.label)}已经是当前最密集的竞争层（${topCompetition.count} 个），新增同类门店需要先证明自己不是简单复制。`,
      score: 0.72,
    })
  }

  const concentrationShare = profile.dominantPrimary?.share || dominantCategories[0]?.share || 0
  const secondShare = profile.primaryCategories?.[1]?.share || dominantCategories[1]?.share || 0
  if (
    concentrationShare >= 0.48
    || (concentrationShare >= 0.42 && concentrationShare - secondShare >= 0.12)
  ) {
    signals.push({
      kind: 'mono_structure_risk',
      title: '头部结构已经偏单一',
      detail: `当前头部结构主要由${dominantPrimaryText}牵引，如果直接继续堆同类业态，收益更容易被现有强势供给稀释，反而补位型机会更值得优先看。`,
      score: Number(Math.min(Math.max(concentrationShare, 0.58), 0.82).toFixed(2)),
    })
  }

  return signals.slice(0, 4)
}
