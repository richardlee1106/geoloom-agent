import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { SkillExecutionResult } from '../../types.js'

export async function inspectAnchorCellAction(
  payload: { lon: number, lat: number },
  deps: { bridge: PythonBridge },
): Promise<SkillExecutionResult<{
  context: Record<string, unknown>
  models_used: string[]
  semantic_evidence: ReturnType<typeof toSemanticEvidenceStatus>
}>> {
  const result = await deps.bridge.getCellContext(payload.lon, payload.lat)
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))

  return {
    ok: true,
    data: {
      context: result.context || {},
      models_used: Array.isArray(result.models_used) ? result.models_used : [],
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'inspect_anchor_cell',
      audited: false,
    },
  }
}
