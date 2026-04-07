import {
  createTemplateRegistry,
  type TemplateAction,
  type TemplateBuildResult,
  type TemplateDefinition
} from '../../components/ai/templateRegistry'
import type { IntentType, TemplateContext } from '../../utils/aiTemplateMetrics'
import { getTemplateWeight } from '../../services/aiTelemetry.js'

interface TemplateWidget {
  id: string
  title: string
  subtitle: string
  lines: string[]
  actions: TemplateAction[]
  score: number
}

interface ScoredTemplate {
  template: TemplateDefinition
  score: number
}

const INTENT_TEMPLATE_BONUS: Record<IntentType, Record<string, number>> = {
  macro: {
    hotspot_overview: 36,
    dominant_industry: 34,
    industry_overlap_radiation: 30,
    confidence_watch: 16
  },
  micro: {
    opportunity_window: 34,
    risk_radar: 30,
    accessibility_snapshot: 24,
    confidence_watch: 12
  },
  comparison: {
    comparison_digest: 44,
    industry_overlap_radiation: 20,
    dominant_industry: 14,
    confidence_watch: 10
  }
}

const FALLBACK_TEMPLATE_ORDER = ['confidence_watch', 'accessibility_snapshot'] as const

function toArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function toSafeTextList(value: unknown): string[] {
  return toArray(value)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 4)
}

function toSafeActions(value: unknown): TemplateAction[] {
  return toArray(value)
    .filter((action) => action && typeof action === 'object' && !Array.isArray(action))
    .map<TemplateAction | null>((action) => {
      const actionObject = action as Record<string, unknown>
      const type = String(actionObject.type || '').trim()
      const label = String(actionObject.label || '').trim()
      if (!type || !label) return null
      if (type !== 'locate' && type !== 'followup') return null
      return {
        type,
        label,
        payload: actionObject.payload ?? null
      }
    })
    .filter((action): action is TemplateAction => Boolean(action))
    .slice(0, 3)
}

function toIntentType(value: unknown): IntentType {
  return value === 'comparison' || value === 'micro' ? value : 'macro'
}

function normalizeTemplateContext(context: Partial<TemplateContext> | null | undefined): TemplateContext {
  return {
    intentType: toIntentType(context?.intentType),
    intentMode: typeof context?.intentMode === 'string' && context.intentMode.trim() ? context.intentMode : null,
    queryType: typeof context?.queryType === 'string' && context.queryType.trim() ? context.queryType : null,
    traceId: typeof context?.traceId === 'string' && context.traceId.trim() ? context.traceId : null,
    hotspots: toArray(context?.hotspots),
    regions: toArray(context?.regions),
    fuzzyRegions: toArray(context?.fuzzyRegions),
    stats: context?.stats && typeof context.stats === 'object' && !Array.isArray(context.stats)
      ? context.stats
      : {},
    industryOverlap: context?.industryOverlap || { score: 0, topRegion: null, topPair: [] },
    radiationCoverage: context?.radiationCoverage || { score: 0, basis: 'insufficient' },
    confidence: context?.confidence || { score: 0, model: 'unknown' },
    risk: context?.risk || { score: 0, highAmbiguityCount: 0 },
    accessibility: context?.accessibility || { score: 0, basis: 'proxy' }
  }
}

function scoreTemplate(template: TemplateDefinition, context: TemplateContext): number {
  const baseScore = Number(template.score?.(context) || 0)
  const intentBonus = Number(INTENT_TEMPLATE_BONUS[context.intentType]?.[template.id] || 0)
  const richnessBonus = context.hotspots.length + context.regions.length + context.fuzzyRegions.length > 5 ? 2 : 0
  const learningWeight = context.traceId ? Number(getTemplateWeight(template.id) || 1) : 1
  const learningBonus = Number.isFinite(learningWeight) ? (learningWeight - 1) * 25 : 0
  return baseScore + intentBonus + richnessBonus + learningBonus
}

function resolveMaxTemplateCount(context: TemplateContext, candidates: ScoredTemplate[]): number {
  if (!candidates.length) return 0

  const evidenceSignals = [
    context.hotspots.length > 0,
    context.regions.length > 0,
    context.fuzzyRegions.length > 0
  ].filter(Boolean).length

  if (evidenceSignals === 0) return 1
  if (context.intentType === 'comparison') return Math.min(3, Math.max(2, evidenceSignals), candidates.length)
  if (context.intentType === 'micro') return Math.min(3, Math.max(2, evidenceSignals), candidates.length)
  return Math.min(3, Math.max(2, evidenceSignals), candidates.length)
}

function hasCoreEvidence(context: TemplateContext): boolean {
  return context.hotspots.length > 0 || context.regions.length > 0 || context.fuzzyRegions.length > 0
}

function mapToWidget(template: TemplateDefinition, context: TemplateContext, score = 0): TemplateWidget {
  const built: TemplateBuildResult = template.build?.(context) || {}
  return {
    id: template.id,
    title: template.title,
    subtitle: template.subtitle,
    lines: toSafeTextList(built.lines),
    actions: toSafeActions(built.actions),
    score: Number(score) || 0
  }
}

export function useIntentTemplateSelector(): {
  selectTemplates: (context: Partial<TemplateContext> | null | undefined) => TemplateWidget[]
} {
  const registry = createTemplateRegistry()

  function selectTemplates(context: Partial<TemplateContext> | null | undefined): TemplateWidget[] {
    const safeContext = normalizeTemplateContext(context)

    const availableTemplates = registry
      .filter((template) => template.isAvailable?.(safeContext))
      .map((template) => ({
        template,
        score: scoreTemplate(template, safeContext)
      }))
      .sort((a, b) => b.score - a.score)

    if (!availableTemplates.length) return []

    if (!hasCoreEvidence(safeContext)) {
      const fallback = FALLBACK_TEMPLATE_ORDER
        .map((id) => availableTemplates.find((item) => item.template.id === id))
        .find((item): item is ScoredTemplate => Boolean(item))
      if (fallback) return [mapToWidget(fallback.template, safeContext, fallback.score)]
      return [mapToWidget(availableTemplates[0].template, safeContext, availableTemplates[0].score)]
    }

    const maxCount = resolveMaxTemplateCount(safeContext, availableTemplates)
    return availableTemplates
      .slice(0, maxCount)
      .map((item) => mapToWidget(item.template, safeContext, item.score))
  }

  return {
    selectTemplates
  }
}
