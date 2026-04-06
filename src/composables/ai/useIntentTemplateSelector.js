import { createTemplateRegistry } from '../../components/ai/templateRegistry'
import { getTemplateWeight } from '../../services/aiTelemetry'

const INTENT_TEMPLATE_BONUS = {
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

const FALLBACK_TEMPLATE_ORDER = ['confidence_watch', 'accessibility_snapshot']

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function toSafeTextList(value) {
  return toArray(value)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 4)
}

function toSafeActions(value) {
  return toArray(value)
    .filter((action) => action && typeof action === 'object' && action.type && action.label)
    .map((action) => ({
      type: action.type,
      label: String(action.label),
      payload: action.payload ?? null
    }))
    .slice(0, 3)
}

function scoreTemplate(template, context) {
  const baseScore = Number(template.score?.(context) || 0)
  const intentBonus = Number(INTENT_TEMPLATE_BONUS[context.intentType]?.[template.id] || 0)
  const richnessBonus = context.hotspots.length + context.regions.length + context.fuzzyRegions.length > 5 ? 2 : 0
  const learningWeight = context.traceId ? Number(getTemplateWeight(template.id) || 1) : 1
  const learningBonus = Number.isFinite(learningWeight) ? (learningWeight - 1) * 25 : 0
  return baseScore + intentBonus + richnessBonus + learningBonus
}

function resolveMaxTemplateCount(context, candidates) {
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

function hasCoreEvidence(context) {
  return context.hotspots.length > 0 || context.regions.length > 0 || context.fuzzyRegions.length > 0
}

function mapToWidget(template, context, score = 0) {
  const built = template.build?.(context) || {}
  return {
    id: template.id,
    title: template.title,
    subtitle: template.subtitle,
    lines: toSafeTextList(built.lines),
    actions: toSafeActions(built.actions),
    score: Number(score) || 0
  }
}

export function useIntentTemplateSelector() {
  const registry = createTemplateRegistry()

  function selectTemplates(context) {
    const safeContext = {
      intentType: context?.intentType || 'macro',
      hotspots: toArray(context?.hotspots),
      regions: toArray(context?.regions),
      fuzzyRegions: toArray(context?.fuzzyRegions),
      industryOverlap: context?.industryOverlap || { score: 0, topRegion: null, topPair: [] },
      radiationCoverage: context?.radiationCoverage || { score: 0, basis: 'insufficient' },
      confidence: context?.confidence || { score: 0, model: 'unknown' },
      risk: context?.risk || { score: 0, highAmbiguityCount: 0 },
      accessibility: context?.accessibility || { score: 0, basis: 'proxy' },
      queryType: context?.queryType || null,
      traceId: context?.traceId || null
    }

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
        .find(Boolean)
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
