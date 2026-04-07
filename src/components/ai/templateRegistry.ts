import type {
  IntentType,
  TemplateContext
} from '../../utils/aiTemplateMetrics'

export interface TemplateAction {
  type: 'locate' | 'followup'
  label: string
  payload: unknown
}

export interface TemplateBuildResult {
  lines?: unknown
  actions?: unknown
}

export interface TemplateDefinition {
  id: string
  title: string
  subtitle: string
  isAvailable?: (context: TemplateContext) => boolean
  score?: (context: TemplateContext) => number
  build?: (context: TemplateContext) => TemplateBuildResult
}

function percent(value: unknown): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '--'
  return `${Math.round(Math.max(0, Math.min(1, num)) * 100)}%`
}

function regionName(region: TemplateContext['regions'][number] | null | undefined): string {
  if (!region) return '片区'
  const raw = String(region.name || '')
  return raw.endsWith('片区') ? raw : `${raw}片区`
}

function hotspotName(hotspot: TemplateContext['hotspots'][number] | null | undefined): string {
  if (!hotspot) return '热点区域'
  const firstCategory = hotspot.dominantCategories[0]
  const categoryLabel = firstCategory && typeof firstCategory === 'object' && !Array.isArray(firstCategory)
    ? String((firstCategory as Record<string, unknown>).category || '')
    : ''
  return String(hotspot.name || categoryLabel || '热点区域')
}

function locateAction(label: string, payload: unknown): TemplateAction[] {
  return payload ? [{ type: 'locate', label, payload }] : []
}

function followupAction(label: string, payload: unknown): TemplateAction[] {
  return payload ? [{ type: 'followup', label, payload }] : []
}

function scoreByIntent(
  context: TemplateContext,
  map: Partial<Record<IntentType, number>>
): number {
  return Number(map[context.intentType] ?? map.macro ?? 0)
}

export function createTemplateRegistry(): TemplateDefinition[] {
  return [
    {
      id: 'hotspot_overview',
      title: '热点区域',
      subtitle: '识别活力聚集与空间锚点',
      isAvailable: (context) => context.hotspots.length > 0,
      score: (context) =>
        scoreByIntent(context, { macro: 100, micro: 76, comparison: 72 }) +
        Math.min(context.hotspots.length, 3) * 2,
      build: (context) => {
        const top = context.hotspots[0]
        return {
          lines: context.hotspots
            .slice(0, 3)
            .map((item, index) => `${index + 1}. ${hotspotName(item)} · ${item.poiCount} POI`),
          actions: [
            ...locateAction('定位核心热点', top?.center),
            ...followupAction(
              '追问热点成因',
              top ? `请解释「${hotspotName(top)}」形成热点的驱动因素，并给出3个可验证指标。` : ''
            )
          ]
        }
      }
    },
    {
      id: 'dominant_industry',
      title: '主导业态',
      subtitle: '主导业态与空间承载强度',
      isAvailable: (context) => context.regions.length > 0,
      score: (context) =>
        scoreByIntent(context, { macro: 98, micro: 72, comparison: 80 }) +
        Math.round((context.regions[0]?.membershipScore || 0) * 10),
      build: (context) => {
        const top = context.regions[0]
        return {
          lines: context.regions.slice(0, 3).map((region, index) => {
            const category = region.dominantCategory || region.dominantCategories[0]?.category || '综合'
            return `${index + 1}. ${regionName(region)} · ${category} · 隶属度 ${percent(region.membershipScore)}`
          }),
          actions: [
            ...locateAction('定位主导业态', top?.center),
            ...followupAction(
              '生成经营策略',
              top ? `请围绕「${regionName(top)}」输出经营策略：目标客群、业态组合、投入优先级。` : ''
            )
          ]
        }
      }
    },
    {
      id: 'industry_overlap_radiation',
      title: '业态辐射覆盖',
      subtitle: '多业态重叠与复合辐射能力',
      isAvailable: (context) => context.regions.length > 0,
      score: (context) =>
        scoreByIntent(context, { macro: 96, micro: 70, comparison: 92 }) +
        Math.round(context.industryOverlap.score * 20) +
        Math.round((context.radiationCoverage?.score || 0) * 14),
      build: (context) => {
        const top = context.industryOverlap.topRegion
        const pair = context.industryOverlap.topPair || []
        const pairText = pair.length === 2 ? `${pair[0].category} + ${pair[1].category}` : '业态重叠待确认'
        return {
          lines: [
            `重叠指数：${percent(context.industryOverlap.score)}`,
            `辐射覆盖：${percent(context.radiationCoverage?.score)}`,
            top ? `重叠核心：${regionName(top)}` : '重叠核心：暂无高重叠片区',
            `辐射组合：${pairText}`
          ],
          actions: [
            ...locateAction('定位重叠核心', top?.center),
            ...followupAction(
              '展开重叠解读',
              top
                ? `请分析「${regionName(top)}」中多业态重叠的成因，并给出协同经营建议。`
                : '请解释当前区域多业态重叠较弱的原因，并给出改善建议。'
            )
          ]
        }
      }
    },
    {
      id: 'opportunity_window',
      title: '机会窗口',
      subtitle: '热点与业态组合的可执行机会点',
      isAvailable: (context) => context.hotspots.length > 0 || context.regions.length > 0,
      score: (context) => scoreByIntent(context, { macro: 82, micro: 100, comparison: 60 }),
      build: (context) => {
        const hotspot = context.hotspots[0]
        const region = context.regions[0]
        return {
          lines: [
            hotspot ? `优先观察：${hotspotName(hotspot)}` : '优先观察：缺少热点证据',
            region ? `业态切入：${regionName(region)}` : '业态切入：缺少主导业态证据',
            context.intentType === 'micro' ? '建议动作：先小范围验证，再扩展覆盖' : '建议动作：先分层选址，再做业态组合'
          ],
          actions: followupAction(
            '输出机会清单',
            '请基于当前热点与主导业态，输出3个可执行机会点并说明适配业态。'
          )
        }
      }
    },
    {
      id: 'risk_radar',
      title: '风险雷达',
      subtitle: '竞争重叠与边界不确定风险',
      isAvailable: (context) => context.fuzzyRegions.length > 0 || context.industryOverlap.score > 0.4,
      score: (context) =>
        scoreByIntent(context, { macro: 68, micro: 90, comparison: 70 }) +
        Math.round(context.risk.score * 20),
      build: (context) => {
        const fuzzy = context.fuzzyRegions[0]
        return {
          lines: [
            `风险指数：${percent(context.risk.score)}`,
            fuzzy ? `首要风险区：${fuzzy.name}` : '首要风险区：暂无显著模糊边界',
            `高歧义片区数：${context.risk.highAmbiguityCount}`
          ],
          actions: followupAction(
            '获取风险处置建议',
            fuzzy
              ? `请解释「${fuzzy.name}」的风险来源，并给出降低不确定性的具体措施。`
              : '请给出当前区域竞争与边界风险的预警清单及应对建议。'
          )
        }
      }
    },
    {
      id: 'accessibility_snapshot',
      title: '可达性快照',
      subtitle: '路网贴合与可达效率评估',
      isAvailable: () => true,
      score: (context) => scoreByIntent(context, { macro: 62, micro: 84, comparison: 58 }),
      build: (context) => ({
        lines: [
          `可达性指数：${percent(context.accessibility.score)}`,
          `评估依据：${context.accessibility.basis === 'road_fit' ? '路网/覆盖指标' : '证据代理推断'}`,
          `查询模式：${context.queryType || 'area_analysis'}`
        ],
        actions: followupAction('追问可达性细节', '请评估该区域15分钟可达性短板，并给出优化路径。')
      })
    },
    {
      id: 'comparison_digest',
      title: '结构对比摘要',
      subtitle: '候选片区差异与策略对照',
      isAvailable: (context) => context.regions.length > 1 || context.hotspots.length > 1 || context.intentType === 'comparison',
      score: (context) => scoreByIntent(context, { macro: 55, micro: 60, comparison: 100 }),
      build: (context) => {
        const [firstRegion, secondRegion] = context.regions
        const [firstHotspot, secondHotspot] = context.hotspots
        const lines: string[] = []
        if (firstRegion && secondRegion) {
          lines.push(`业态对比：${regionName(firstRegion)} vs ${regionName(secondRegion)}`)
          lines.push(`隶属度：${percent(firstRegion.membershipScore)} vs ${percent(secondRegion.membershipScore)}`)
        } else if (firstHotspot && secondHotspot) {
          lines.push(`热点对比：${hotspotName(firstHotspot)} vs ${hotspotName(secondHotspot)}`)
          lines.push(`规模对比：${firstHotspot.poiCount} POI vs ${secondHotspot.poiCount} POI`)
        } else {
          lines.push('当前可用于对比的样本不足')
        }
        lines.push('建议：对比客群结构、竞争密度与业态互补性')
        return {
          lines,
          actions: followupAction('展开对比分析', '请输出两个候选片区的差异化策略与优先级。')
        }
      }
    },
    {
      id: 'confidence_watch',
      title: '可信度看板',
      subtitle: '模型输出稳定性与证据可信度',
      isAvailable: () => true,
      score: (context) => scoreByIntent(context, { macro: 72, micro: 66, comparison: 74 }),
      build: (context) => ({
        lines: [
          `边界可信度：${percent(context.confidence.score)}`,
          `模型：${context.confidence.model || 'unknown'}`,
          `证据规模：热点 ${context.hotspots.length} / 片区 ${context.regions.length}`
        ],
        actions: []
      })
    }
  ]
}
