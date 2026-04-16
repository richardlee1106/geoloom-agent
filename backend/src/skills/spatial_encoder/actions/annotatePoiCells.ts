import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { SkillExecutionResult } from '../../types.js'

export async function annotatePoiCellsAction(
  payload: {
    anchor_lon: number
    anchor_lat: number
    user_query?: string
    task_type?: string | null
    pois?: Array<Record<string, unknown>>
  },
  deps: { bridge: PythonBridge },
): Promise<SkillExecutionResult<{
  anchor_cell_context: Record<string, unknown>
  results: Array<Record<string, unknown>>
  model_route?: string | null
  models_used: string[]
  semantic_evidence: ReturnType<typeof toSemanticEvidenceStatus>
}>> {
  const result = await deps.bridge.batchPoiCellContext({
    anchorLon: payload.anchor_lon,
    anchorLat: payload.anchor_lat,
    userQuery: payload.user_query,
    taskType: payload.task_type,
    pois: Array.isArray(payload.pois) ? payload.pois : [],
  })
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))

  return {
    ok: true,
    data: {
      anchor_cell_context: result.anchor_cell_context || {},
      results: Array.isArray(result.results) ? result.results : [],
      model_route: result.model_route || null,
      models_used: Array.isArray(result.models_used) ? result.models_used : [],
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'annotate_poi_cells',
      audited: false,
    },
  }
}
