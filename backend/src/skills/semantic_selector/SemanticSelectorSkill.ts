import type { AreaInsightInput } from '../../chat/types.js'
import { IntentAwareAreaSemanticDenoiser, type AreaSemanticDenoiser } from '../../evidence/areaInsight/semanticDenoiser.js'
import type { PythonBridge } from '../../integration/pythonBridge.js'
import type { SkillActionDefinition, SkillDefinition, SkillExecutionResult } from '../types.js'

const actions: Record<string, SkillActionDefinition> = {
  select_area_evidence: {
    name: 'select_area_evidence',
    description: '按当前 query/semantic focus，从 area insight 中选择真正相关的结构证据与代表样本',
    inputSchema: {
      type: 'object',
      properties: {
        raw_query: { type: 'string' },
        semantic_focus: { type: 'string' },
        anchor_name: { type: 'string' },
        area_insight: {
          type: 'object',
          properties: {
            categoryHistogram: { type: 'array', items: { type: 'object' } },
            ringDistribution: { type: 'array', items: { type: 'object' } },
            representativeSamples: { type: 'array', items: { type: 'object' } },
            competitionDensity: { type: 'array', items: { type: 'object' } },
            hotspotCells: { type: 'array', items: { type: 'object' } },
            aoiContext: { type: 'array', items: { type: 'object' } },
            landuseContext: { type: 'array', items: { type: 'object' } },
          },
        },
        fallback_rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['raw_query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        selected_rows: { type: 'array', items: { type: 'object' } },
        selected_area_insight: { type: 'object' },
        semantic_evidence: { type: 'object' },
        diagnostics: { type: 'object' },
      },
    },
  },
}

function trimText(value: unknown) {
  return String(value || '').trim()
}

export interface SemanticSelectorSkillOptions {
  selector?: AreaSemanticDenoiser
  bridge?: PythonBridge
  fallbackBridge?: PythonBridge
}

export function createSemanticSelectorSkill(options: SemanticSelectorSkillOptions = {}): SkillDefinition {
  const selector = options.selector || new IntentAwareAreaSemanticDenoiser({
    bridge: options.bridge,
    fallbackBridge: options.fallbackBridge,
  })

  return {
    name: 'semantic_selector',
    description: '基于 query 语义和向量相似度，从 area insight 中按需选择证据',
    capabilities: ['query_driven_selection', 'semantic_area_focus'],
    actions,
    async execute(action, payload): Promise<SkillExecutionResult> {
      switch (action) {
        case 'select_area_evidence': {
          const record = (payload || {}) as Record<string, unknown>
          const rawQuery = trimText(record.raw_query)
          const semanticFocus = trimText(record.semantic_focus)
          const anchorName = trimText(record.anchor_name)
          const areaInsight = ((record.area_insight || {}) as AreaInsightInput)
          const fallbackRows = Array.isArray(record.fallback_rows)
            ? record.fallback_rows as Record<string, unknown>[]
            : []

          const hasAreaInsight = [
            areaInsight.categoryHistogram,
            areaInsight.ringDistribution,
            areaInsight.representativeSamples,
            areaInsight.competitionDensity,
            areaInsight.hotspotCells,
            areaInsight.aoiContext,
            areaInsight.landuseContext,
          ].some((value) => Array.isArray(value) && value.length > 0)

          if (!rawQuery) {
            return {
              ok: false,
              error: {
                code: 'missing_raw_query',
                message: 'raw_query is required for semantic selection',
              },
              meta: {
                action,
                audited: false,
              },
            }
          }

          if (!hasAreaInsight && fallbackRows.length === 0) {
            return {
              ok: false,
              error: {
                code: 'missing_area_insight',
                message: 'semantic selection requires current area evidence',
              },
              meta: {
                action,
                audited: false,
              },
            }
          }

          const result = await selector.denoise({
            rawQuery: semanticFocus || rawQuery,
            anchorName: anchorName || null,
            areaInsight,
            fallbackRows,
          })

          return {
            ok: true,
            data: {
              selected_rows: result.rows,
              selected_area_insight: result.areaInsight,
              semantic_evidence: result.semanticEvidence,
              diagnostics: {
                applied: result.diagnostics.applied,
                mode: 'query_driven',
                focusQuery: result.diagnostics.focusQuery || semanticFocus || rawQuery,
                selectedCategories: result.diagnostics.keptCategories,
                selectedSamples: result.diagnostics.keptSamples,
                skippedCategories: result.diagnostics.droppedCategories,
                skippedSamples: result.diagnostics.droppedSamples,
                threshold: result.diagnostics.threshold,
              },
            },
            meta: {
              action,
              audited: true,
            },
          }
        }
        default:
          return {
            ok: false,
            error: {
              code: 'unsupported_action',
              message: `Unknown semantic_selector action "${action}"`,
            },
            meta: {
              action,
              audited: false,
            },
          }
      }
    },
  }
}
