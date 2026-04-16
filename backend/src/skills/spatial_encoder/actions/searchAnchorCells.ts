import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { SkillExecutionResult } from '../../types.js'

export async function searchAnchorCellsAction(
  payload: {
    anchor_lon: number
    anchor_lat: number
    user_query?: string
    task_type?: string | null
    top_k?: number
    max_distance_m?: number | null
  },
  deps: { bridge: PythonBridge },
): Promise<SkillExecutionResult<{
  anchor_cell_context: Record<string, unknown>
  cells: Array<Record<string, unknown>>
  model_route?: string | null
  models_used: string[]
  search_radius_m?: number | null
  per_cell_radius_m?: number | null
  support_bucket_distribution?: Array<Record<string, unknown>>
  dominant_buckets?: string[]
  scene_tags?: string[]
  cell_mix?: Array<Record<string, unknown>>
  macro_uncertainty?: Record<string, unknown>
  semantic_evidence: ReturnType<typeof toSemanticEvidenceStatus>
}>> {
  const result = await deps.bridge.searchNearbyCells({
    anchorLon: payload.anchor_lon,
    anchorLat: payload.anchor_lat,
    userQuery: payload.user_query,
    taskType: payload.task_type,
    topK: payload.top_k,
    maxDistanceM: payload.max_distance_m,
  })
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))

  return {
    ok: true,
    data: {
      anchor_cell_context: result.anchor_cell_context || {},
      cells: Array.isArray(result.cells) ? result.cells : [],
      model_route: result.model_route || null,
      models_used: Array.isArray(result.models_used) ? result.models_used : [],
      search_radius_m: result.search_radius_m ?? null,
      per_cell_radius_m: result.per_cell_radius_m ?? null,
      support_bucket_distribution: Array.isArray(result.support_bucket_distribution)
        ? result.support_bucket_distribution
        : [],
      dominant_buckets: Array.isArray(result.dominant_buckets) ? result.dominant_buckets : [],
      scene_tags: Array.isArray(result.scene_tags) ? result.scene_tags : [],
      cell_mix: Array.isArray(result.cell_mix) ? result.cell_mix : [],
      macro_uncertainty: result.macro_uncertainty && typeof result.macro_uncertainty === 'object'
        ? result.macro_uncertainty
        : {},
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'search_anchor_cells',
      audited: false,
    },
  }
}
