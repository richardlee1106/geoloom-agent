import type { EvidenceView } from '../chat/types.js'
import { normalizeTransportName, parseMetroExit } from './transportNormalization.js'

function formatDistance(distance: unknown) {
  const numeric = Number(distance)
  if (!Number.isFinite(numeric)) return '未知距离'
  if (numeric >= 1500) {
    return `${(numeric / 1000).toFixed(1)} 公里`
  }
  return `${Math.round(numeric)} 米`
}

function trimClause(text: unknown) {
  return String(text || '').trim().replace(/[；;。]+$/u, '')
}

function joinClauses(clauses: Array<unknown>, ending = '。') {
  const cleaned = clauses
    .map((clause) => trimClause(clause))
    .filter(Boolean)

  if (cleaned.length === 0) return ''
  return `${cleaned.join('；')}${ending}`
}

function buildMarkdownSection(title: string, lines: Array<unknown>) {
  const cleaned = lines
    .map((line) => trimClause(line))
    .filter(Boolean)

  if (cleaned.length === 0) return ''
  return [`## ${title}`, ...cleaned.map((line) => `- ${line}`)].join('\n')
}

function buildMarkdownNumberedSection(title: string, lines: Array<unknown>) {
  const cleaned = lines
    .map((line) => trimClause(line))
    .filter(Boolean)

  if (cleaned.length === 0) return ''
  return [`## ${title}`, ...cleaned.map((line, index) => `${index + 1}. ${line}`)].join('\n')
}

function buildMarkdownParagraphSection(title: string, paragraphs: Array<unknown>) {
  const cleaned = paragraphs
    .map((paragraph) => trimClause(paragraph))
    .filter(Boolean)

  if (cleaned.length === 0) return ''
  return [`## ${title}`, ...cleaned].join('\n\n')
}

function humanizeCategoryLabel(label: unknown) {
  const normalized = String(label || '').trim()
  if (!normalized) return '未分类'

  const aliasMap: Record<string, string> = {
    '餐饮美食': '餐饮',
    '购物服务': '零售配套',
    '生活服务': '生活服务',
    '交通设施服务': '交通接驳',
    '科教文化服务': '教育文化',
    '医疗保健服务': '医疗配套',
    '体育休闲服务': '休闲活力',
    '住宿服务': '停留配套',
  }

  return aliasMap[normalized] || normalized
}

function formatCategorySummary(label: unknown) {
  return humanizeCategoryLabel(label)
}

function formatInsightCategory(label: unknown) {
  return humanizeCategoryLabel(label)
}

function pickExamplesByBucket(view: EvidenceView, labels: string[] = []) {
  return labels
    .map((label) => {
      const match = view.items.find((item) => (item.categoryMain || item.category || '未分类') === label)
      if (!match) return null
      return `${humanizeCategoryLabel(label)}（如 ${match.name}）`
    })
    .filter(Boolean)
}

function pickRepresentativeSampleNames(view: EvidenceView, limit = 3) {
  return (view.representativeSamples?.length ? view.representativeSamples : view.items)
    .map((item) => String(item.name || '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function describeRepresentativeSamples(view: EvidenceView, limit = 3) {
  const names = pickRepresentativeSampleNames(view, limit)
  if (names.length === 0) return ''
  return `代表性样本先看${names.join('、')}`
}

function describeAreaHotspot(view: EvidenceView) {
  const hotspot = view.hotspots?.[0]
  const sampleNames = hotspot?.sampleNames?.length
    ? hotspot.sampleNames.slice(0, 2)
    : pickRepresentativeSampleNames(view, 2)

  if (!hotspot) {
    return sampleNames.length > 0 ? `${sampleNames.join('、')}周边` : '核心圈层'
  }

  if (sampleNames.length >= 2) {
    return `${sampleNames[0]}、${sampleNames[1]}一带`
  }

  if (sampleNames.length === 1) {
    return `${sampleNames[0]}周边`
  }

   return hotspot.label
}

function countLowSignalBuckets(buckets: Array<{ label: string, value: number }> = []) {
  const lowSignalLabels = new Set(['地名地址信息', '未分类'])
  return buckets
    .filter((bucket) => lowSignalLabels.has(String(bucket.label || '').trim()))
    .reduce((sum, bucket) => sum + Number(bucket.value || 0), 0)
}

function inferAreaOpportunity(buckets: Array<{ label: string, value: number }> = [], total = 0) {
  if (total <= 0) return '样本还不够，机会判断需要更多周边数据。'

  const bucketMap = new Map(buckets.map((bucket) => [bucket.label, bucket.value]))
  const focus = [
    ['生活服务', '日常生活服务还可以继续补位'],
    ['医疗保健服务', '医疗类配套偏弱，适合做补缺观察'],
    ['体育休闲服务', '休闲与停留型内容还有补充空间'],
    ['住宿服务', '停留型配套不算强，可以继续观察'],
  ] as const

  const missing = focus.find(([label]) => !bucketMap.has(label))
  if (missing) {
    return missing[1]
  }

  const sparse = focus.find(([label]) => (bucketMap.get(label) || 0) / total < 0.12)
  if (sparse) {
    return sparse[1]
  }

  return '结构已经比较完整，更值得盯住的是把高频业态做得更有差异化。'
}

type SemanticLabel =
  | '校园'
  | '居住'
  | '商业'
  | '办公'
  | '交通'
  | '公共服务'
  | '产业'
  | '医疗'
  | '自然背景'

const SEMANTIC_RULES: Array<{ label: SemanticLabel, keywords: string[] }> = [
  { label: '校园', keywords: ['education', 'school', 'campus', 'university', 'college', '大学', '学院', '学校', '校区', '校园', '教学', '科研'] },
  { label: '居住', keywords: ['residential', 'community', 'apartment', 'housing', '住宅', '小区', '社区', '公寓', '生活区', '宿舍', '家属区', '家园'] },
  { label: '商业', keywords: ['commercial', 'mall', 'retail', 'shopping', 'business', 'plaza', '广场', '商业', '商场', '购物', '步行街', '商业带', '商圈'] },
  { label: '办公', keywords: ['office', '写字楼', '商务楼', '办公'] },
  { label: '交通', keywords: ['transport', 'station', 'metro', 'transit', '地铁', '车站', '交通枢纽', '站点'] },
  { label: '公共服务', keywords: ['public_service', 'government', '政务', '公共服务', '市民'] },
  { label: '产业', keywords: ['industrial', 'factory', 'industry', '园区', '产业', '厂区'] },
  { label: '医疗', keywords: ['medical', 'hospital', 'clinic', '医疗', '医院', '门诊', '药店'] },
  { label: '自然背景', keywords: ['water', 'river', 'lake', 'park', 'green', 'forest', 'natural', '湖', '河', '公园', '绿地', '山体', '湿地'] },
]

function addSemanticWeight(counter: Map<SemanticLabel, number>, label: SemanticLabel, weight: number) {
  if (!Number.isFinite(weight) || weight <= 0) return
  counter.set(label, (counter.get(label) || 0) + weight)
}

function collectSemanticLabels(text: string) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return [] as SemanticLabel[]

  return SEMANTIC_RULES
    .filter((rule) => rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
    .map((rule) => rule.label)
}

function pickMeaningfulAoiNames(view: EvidenceView) {
  return (view.aoiContext || [])
    .map((item) => {
      const name = String(item.name || '').trim()
      if (!name) return null
      const labels = collectSemanticLabels(`${name} ${String(item.fclass || '')}`)
      const meaningful = labels.filter((label) => label !== '自然背景')
      if (meaningful.length === 0) return null
      return {
        name,
        weight: Number(item.population || item.areaSqm || 1),
      }
    })
    .filter((item): item is { name: string, weight: number } => Boolean(item))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 2)
    .map((item) => item.name)
}

function describeSemanticAreaType(weights: Array<{ label: Exclude<SemanticLabel, '自然背景'>, weight: number }>) {
  const labels = weights.map((item) => item.label)
  const hasCampus = labels.includes('校园')
  const hasResidential = labels.includes('居住')
  const hasCommercial = labels.includes('商业')

  if (hasCampus && hasResidential && hasCommercial) {
    return '校园带动的居住-商业混合片区'
  }
  if (hasCampus && hasCommercial) {
    return '校园与商业叠加的混合片区'
  }
  if (hasCampus && hasResidential) {
    return '校园与居住叠加的混合片区'
  }
  if (hasResidential && hasCommercial) {
    return '居住-商业混合片区'
  }
  if (hasCampus) return '校园片区'
  if (hasResidential) return '居住片区'
  if (hasCommercial) return '商业片区'
  if (labels.includes('办公')) return '办公片区'
  if (labels.includes('公共服务')) return '公共服务片区'
  if (labels.includes('产业')) return '产业片区'
  if (labels.includes('医疗')) return '医疗服务片区'
  if (labels.includes('交通')) return '交通节点片区'
  return ''
}

function inferAreaSemanticContext(view: EvidenceView) {
  const counter = new Map<SemanticLabel, number>()

  for (const item of view.landuseContext || []) {
    const normalized = String(item.landType || '').trim().toLowerCase()
    const weight = Number(item.totalAreaSqm || item.parcelCount || 1)
    if (normalized === 'mixed_use') {
      addSemanticWeight(counter, '居住', weight * 0.6)
      addSemanticWeight(counter, '商业', weight * 0.6)
      continue
    }

    for (const label of collectSemanticLabels(normalized)) {
      addSemanticWeight(counter, label, weight)
    }
  }

  for (const item of view.aoiContext || []) {
    const combined = `${String(item.name || '')} ${String(item.fclass || '')}`
    const weight = Number(item.population || item.areaSqm || 1)
    for (const label of collectSemanticLabels(combined)) {
      addSemanticWeight(counter, label, weight)
    }
  }

  const meaningfulWeights = [...counter.entries()]
    .filter(([label, weight]) => label !== '自然背景' && weight > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, weight]) => ({
      label: label as Exclude<SemanticLabel, '自然背景'>,
      weight,
    }))
  const areaType = describeSemanticAreaType(meaningfulWeights)
  const aoiNames = pickMeaningfulAoiNames(view)

  if (!areaType && aoiNames.length === 0) {
    return ''
  }

  const nameTail = aoiNames.length > 0
    ? `（AOI 参考：${aoiNames.join('、')}）`
    : ''

  if (!areaType) {
    return nameTail ? `从 AOI 看，片区语义参考主要来自${aoiNames.join('、')}` : ''
  }

  return `从 AOI 与用地看，这里更像${areaType}${nameTail}`
}

/**
 * 构建 entity_alignment 对齐结果的 Markdown section
 * 展示联网搜索与本地 POI 对齐后的验证样本
 */
function buildAlignmentSection(
  items: Array<{ name: string; distance_m?: number | null; category?: string | null; score?: number | null; meta?: Record<string, unknown> }>,
  summary: Record<string, unknown>,
) {
  const dualVerified = items.filter((item) => (item.meta as Record<string, unknown>)?.verification === 'dual_verified')

  const lines: string[] = []

  // 双重验证样本（最高可信度）
  if (dualVerified.length > 0) {
    const names = dualVerified.slice(0, 5).map((item) => item.name)
    lines.push(`已验证推荐：${names.join('、')}`)
  }

  if (lines.length === 0) return ''

  return buildMarkdownSection('联网验证', lines)
}

function inferAreaQuestionMode(view: EvidenceView) {
  const explicit = String(view.meta.questionMode || '').trim()
  if (explicit) return explicit

  const rawQuery = String(view.meta.rawQuery || '').trim()
  if (/居住|商业|混合|片区类型|说明依据/u.test(rawQuery)) return 'semantic'
  if (/开店|开什么店|适合开什么店|值得优先考虑|补什么配套|补位|供给|需求|竞争/u.test(rawQuery)) return 'opportunity'
  if (/异常点|异常/u.test(rawQuery) && !/主导业态|热点|机会|读懂|总结/u.test(rawQuery)) return 'anomaly'
  return 'summary'
}

function describeAreaSubject(view: EvidenceView) {
  const subjectTitle = String(view.areaSubject?.title || '').trim()
  const subjectConfidence = String(view.areaSubject?.confidence || '').trim()
  if (subjectTitle && subjectConfidence === 'high') {
    return `当前范围更适合看作**${subjectTitle}**`
  }

  const semanticContext = inferAreaSemanticContext(view)
  if (semanticContext) {
    return semanticContext
  }

  const anchorName = view.anchor.resolvedPlaceName || view.anchor.displayName || view.anchor.placeName || '当前区域'
  return `当前先按**${anchorName}**理解`
}

function describeEncodedRegionFeatures(view: EvidenceView) {
  const summary = String(view.regionFeatureSummary || '').trim()
  if (summary) {
    return summary
  }

  const labels = (view.regionFeatures || [])
    .map((item) => String(item.label || '').trim())
    .filter(Boolean)
    .slice(0, 4)

  if (labels.length === 0) {
    return ''
  }

  return `编码器提取的片区特征包括：${labels.join('、')}`
}

function describeRepresentativePoiRoles(view: EvidenceView) {
  const profiles = (view.representativePoiProfiles || [])
    .slice(0, 3)
    .map((item) => {
      const topLabels = (item.featureTags || [])
        .map((feature) => String(feature.label || '').trim())
        .filter(Boolean)
        .slice(0, 2)
      if (topLabels.length === 0) return ''
      return `${item.name}更像${topLabels.join('、')}`
    })
    .filter(Boolean)

  if (profiles.length === 0) {
    return ''
  }

  return `代表点角色上，${profiles.join('；')}`
}

function buildStructuredAreaMarkdown(view: EvidenceView, questionMode: string) {
  const dominant = (view.areaProfile?.dominantCategories || [])
    .slice(0, 3)
    .map((bucket) => formatInsightCategory(bucket.label))
    .join('、')
  const sampleNames = pickRepresentativeSampleNames(view, 3)
  const hotspot = describeAreaHotspot(view)
  const semanticContext = inferAreaSemanticContext(view)
  const anomaly = view.anomalySignals?.[0]
  const opportunitySignal = view.opportunitySignals?.[0]
  const competitionWarning = view.opportunitySignals?.find((signal) => signal.kind === 'over_competition_warning')
  const confidenceTail = view.confidence
    ? `当前判断置信度${view.confidence.level === 'high' ? '较高' : view.confidence.level === 'medium' ? '中等' : '偏谨慎'}`
    : ''

  const keyFeatureLines = [
    describeEncodedRegionFeatures(view),
    describeRepresentativePoiRoles(view),
    semanticContext,
    dominant ? `供给结构主要由${dominant}支撑` : '',
    sampleNames.length > 0 ? `代表性样本包括${sampleNames.join('、')}` : '',
    questionMode === 'opportunity' && opportunitySignal?.title
      ? `从经营视角看，当前更值得优先追的是**${opportunitySignal.title}**`
      : '',
  ]

  const hotspotLines = [
    hotspot ? `活力更集中在${hotspot}` : '',
    anomaly ? `结构上需要特别留意：${anomaly.detail}` : '',
  ]

  const riskLines = questionMode === 'semantic'
    ? [
        semanticContext ? `片区语义判断更接近：${semanticContext}` : '',
        anomaly ? `当前最明显的结构风险是${anomaly.detail}` : '',
        opportunitySignal ? `如果继续往经营机会看，当前更值得关注的是${opportunitySignal.detail}` : '',
        confidenceTail,
      ]
    : questionMode === 'opportunity'
      ? [
          opportunitySignal ? `优先方向可以先看：${opportunitySignal.detail}` : '',
          competitionWarning ? `同时要警惕：${competitionWarning.title}` : '',
          anomaly ? `结构层面的隐患是${anomaly.detail}` : '',
          confidenceTail,
        ]
      : [
          opportunitySignal ? `当前更值得继续追的机会是${opportunitySignal.detail}` : '',
          competitionWarning ? `需要同步警惕：${competitionWarning.title}` : '',
          anomaly ? `异常点主要体现在${anomaly.detail}` : '',
          confidenceTail,
        ]

  return [
    buildMarkdownSection('区域主语', [describeAreaSubject(view)]),
    buildMarkdownSection('关键特征', keyFeatureLines),
    buildMarkdownSection('热点与结构', hotspotLines),
    buildMarkdownSection('机会与风险', riskLines),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildFallbackAreaMarkdown(view: EvidenceView, questionMode: string) {
  const buckets = [...(view.buckets || [])].sort((left, right) => right.value - left.value)
  const dominant = buckets
    .slice(0, 3)
    .map((bucket) => formatCategorySummary(bucket.label))
    .join('、')
  const hotspotExamples = pickExamplesByBucket(view, buckets.slice(0, 2).map((bucket) => bucket.label))
  const sampleText = hotspotExamples.length > 0
    ? `代表性样本包括${hotspotExamples.join('、')}`
    : '目前拿到的只是基础周边样本'
  const lowSignalCount = countLowSignalBuckets(buckets)
  const evidenceWarnings: string[] = []
  if (view.items.length < 12) {
    evidenceWarnings.push('样本量还偏少')
  }
  if (lowSignalCount / Math.max(view.items.length, 1) >= 0.25) {
    evidenceWarnings.push('低信号类别占比偏高')
  }

  const warningText = evidenceWarnings.length > 0
    ? `由于${evidenceWarnings.join('，')}，这里先不直接下机会结论`
    : '目前还缺少热点聚合、竞争密度和供需关系证据，这里先不直接下机会结论'
  const semanticContext = inferAreaSemanticContext(view)

  const finalLine = questionMode === 'opportunity'
    ? '建议继续补充竞争密度、需求来源和热点分布证据后，再做正式开店判断'
    : questionMode === 'semantic'
      ? '建议继续补充 AOI、用地和结构分布证据后，再做正式片区归类'
      : '建议继续补充热点聚合、竞争密度和供需关系证据后，再做正式片区判断'

  return [
    buildMarkdownSection('区域主语', [describeAreaSubject(view)]),
    buildMarkdownSection('关键特征', [
      describeEncodedRegionFeatures(view),
      dominant
        ? `当前只拿到基础周边样本汇总，头部特征暂时偏向${dominant}`
        : '当前只拿到基础周边样本汇总，头部特征还不够稳定',
      sampleText,
      semanticContext,
    ]),
    buildMarkdownSection('热点与结构', [
      warningText,
      questionMode === 'semantic'
        ? '当前只拿到基础周边样本，暂时还不够直接判定它更像哪类片区'
        : '',
    ]),
    buildMarkdownSection('机会与风险', [finalLine]),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export class Renderer {
  render(view: EvidenceView) {
    const anchorName = view.anchor.resolvedPlaceName || view.anchor.displayName || view.anchor.placeName || '该地点'

    if (view.type === 'comparison') {
      const summary = (view.pairs || [])
        .map((pair) => `${pair.label}${pair.value} 家`)
        .join('，')
      return [
        buildMarkdownSection('结论', [`围绕 ${anchorName} 和 ${view.secondaryAnchor?.resolvedPlaceName || '另一个地点'} 做对比后，${summary}`]),
        buildMarkdownNumberedSection('对比结果', (view.pairs || []).map((pair) => `${pair.label}：${pair.value} 家`)),
      ]
        .filter(Boolean)
        .join('\n\n')
    }

    if (view.type === 'semantic_candidate') {
      const names = view.items.slice(0, 3).map((item) => `${item.name}（相似度 ${((item.score || 0) * 100).toFixed(0)}%）`)
      return [
        buildMarkdownSection('结论', [`以${anchorName}为参考，当前最相似的片区已经收敛到以下候选`]),
        buildMarkdownNumberedSection('相似片区', names),
      ]
        .filter(Boolean)
        .join('\n\n')
    }

    if (view.type === 'bucket') {
      const lines = (view.buckets || []).map((bucket) => `${bucket.label} ${bucket.value} 个`)
      return [
        buildMarkdownSection('结论', [`以${anchorName}为锚点，当前聚合结果已经形成基础分布`]),
        buildMarkdownNumberedSection('聚合结果', lines),
      ]
        .filter(Boolean)
        .join('\n\n')
    }

    if (view.type === 'transport') {
      const nearest = view.items[0]
      const targetCategory = String(view.meta.targetCategory || '地铁站')

      if (!nearest) {
        return buildMarkdownSection('结论', [`以${anchorName}为锚点，附近暂未找到可用的${targetCategory}`])
      }

      const nearestStation = parseMetroExit(nearest.name)
      const exitNames = [...new Set(view.items
        .map((item) => parseMetroExit(item.name))
        .filter((item) => item.stationName === nearestStation.stationName && item.exitName)
        .map((item) => String(item.exitName)))]

      if (nearestStation.exitName && exitNames.length > 1) {
        return [
          buildMarkdownSection('结论', [`以${anchorName}为锚点，最近的${targetCategory}是${nearestStation.stationName}，最近的出口是${nearestStation.exitName}，距离约${formatDistance(nearest.distance_m)}`]),
          buildMarkdownSection('站口参考', [`可用站口包括${exitNames.join('、')}`]),
        ]
          .filter(Boolean)
          .join('\n\n')
      }

      return buildMarkdownSection('结论', [`以${anchorName}为锚点，最近的${targetCategory}是${nearest.name}，距离约${formatDistance(nearest.distance_m)}`])
    }

    if (view.type === 'area_overview') {
      const questionMode = inferAreaQuestionMode(view)
      // entity_alignment 对齐结果：当存在时，增加「联网验证样本」section
      const alignmentSummary = view.meta.entity_alignment as Record<string, unknown> | undefined
      const alignmentItems = (view.items || []).filter(
        (item) => (item.meta as Record<string, unknown>)?.verification
      )

      if (
        view.areaProfile
        && (
          (view.hotspots?.length || 0) > 0
          || (view.anomalySignals?.length || 0) > 0
          || (view.opportunitySignals?.length || 0) > 0
        )
      ) {
        const base = buildStructuredAreaMarkdown(view, questionMode)
        // 追加联网对齐结果
        if (alignmentItems.length > 0 && alignmentSummary) {
          return base + '\n\n' + buildAlignmentSection(alignmentItems, alignmentSummary)
        }
        return base
      }

      const buckets = [...(view.buckets || [])].sort((left, right) => right.value - left.value)
      if (view.items.length === 0 || buckets.length === 0) {
        const base = [
          buildMarkdownSection('区域主语', [describeAreaSubject(view)]),
          buildMarkdownSection('关键特征', ['当前还没有足够的周边样本，暂时只能给出基础汇总']),
          buildMarkdownSection('机会与风险', ['没法稳定判断主导业态、热点和机会，建议先补充可验证样本']),
        ]
          .filter(Boolean)
          .join('\n\n')
        if (alignmentItems.length > 0 && alignmentSummary) {
          return base + '\n\n' + buildAlignmentSection(alignmentItems, alignmentSummary)
        }
        return base
      }

      const fallback = buildFallbackAreaMarkdown(view, questionMode)
      if (alignmentItems.length > 0 && alignmentSummary) {
        return fallback + '\n\n' + buildAlignmentSection(alignmentItems, alignmentSummary)
      }
      return fallback
    }

    const radiusM = Number(view.meta.radiusM || 800)
    const distanceConstraintMode = String(view.meta.distanceConstraintMode || 'hard')
    const targetCategory = String(view.meta.targetCategory || '相关地点')
    const scopeLabel = String(view.meta.scopeLabel || '').trim()
    const scopeDistricts = Array.isArray(view.meta.scopeDistricts)
      ? view.meta.scopeDistricts.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    const scopeText = distanceConstraintMode === 'soft'
      ? scopeLabel
        ? `围绕${scopeLabel}`
        : `围绕${anchorName}这类片区语义`
      : `在 ${radiusM} 米范围内`

    if (view.items.length === 0) {
      return buildMarkdownParagraphSection(
        '推荐结论',
        [`以${anchorName}为锚点，${scopeText}暂未找到${targetCategory === '相关地点' ? '' : targetCategory}结果。`],
      )
    }

    const hasAlignment = (view.items || []).some(
      (item) => (item.meta as Record<string, unknown>)?.verification
    )

    const visibleItems = view.items.length <= 8
      ? view.items
      : view.items.slice(0, 6)

    const lines = visibleItems
      .map((item, index) => {
        return `${item.name}（${item.category || '未分类'}，约${formatDistance(item.distance_m)}）`
      })

    const hiddenCount = Math.max(view.items.length - visibleItems.length, 0)
    const highlightNames = visibleItems.slice(0, 3).map((item) => item.name).filter(Boolean)
    const usageNotes: string[] = []
    if (scopeDistricts.length > 0) {
      usageNotes.push(`本轮已按 ${scopeDistricts.join('、')} 做范围约束，避免结果越到其他片区。`)
    }
    if (distanceConstraintMode === 'soft') {
      usageNotes.push(scopeLabel
        ? `这是 ${scopeLabel} 的片区级结果，不等于围绕单个站点的步行圈。`
        : '这是片区级 nearby 结果，不等于围绕单个锚点的步行圈。')
    } else {
      usageNotes.push(`候选地点按距离从近到远排序，默认范围是 ${radiusM} 米。`)
    }
    if (hiddenCount > 0) {
      usageNotes.push(`其余 ${hiddenCount} 个结果可在地图和标签云里继续查看。`)
    }

    // 如果有联网对齐结果，追加 alignment section
    const alignmentSummary = view.meta.entity_alignment as Record<string, unknown> | undefined
    const alignmentItems = (view.items || []).filter(
      (item) => (item.meta as Record<string, unknown>)?.verification
    )
    const alignmentTail = (hasAlignment && alignmentSummary && alignmentItems.length > 0)
      ? '\n\n' + buildAlignmentSection(alignmentItems, alignmentSummary)
      : ''

    return [
      buildMarkdownParagraphSection('推荐结论', [
        highlightNames.length > 0
          ? `以${anchorName}为锚点，${scopeText}当前更值得先看 ${highlightNames.join('、')}。`
          : `以${anchorName}为锚点，${scopeText}找到 ${view.items.length} 个${targetCategory === '相关地点' ? '相关地点' : `${targetCategory}相关地点`}。`,
        `当前共保留 ${view.items.length} 个${targetCategory === '相关地点' ? '相关地点' : `${targetCategory}相关地点`}，优先展示距离和证据更靠前的候选。`,
      ]),
      buildMarkdownNumberedSection('就近可选', lines),
      buildMarkdownSection('使用说明', usageNotes),
    ]
      .filter(Boolean)
      .join('\n\n') + alignmentTail
  }
}
