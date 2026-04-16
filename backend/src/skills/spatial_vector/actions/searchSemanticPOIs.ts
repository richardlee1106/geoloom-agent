import type { SemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { SkillExecutionResult } from '../../types.js'
import type { FaissIndex } from '../../../integration/faissIndex.js'

export async function searchSemanticPOIsAction(
  payload: { text: string, top_k?: number },
  deps: { index: FaissIndex },
): Promise<SkillExecutionResult<{
  candidates: Array<{ poi_id: string, name: string, score: number, category: string }>
  semantic_evidence: SemanticEvidenceStatus
}>> {
  const candidates = (await deps.index.searchSemanticPOIs(payload.text, payload.top_k || 5))
    .map((item) => ({
      poi_id: item.id,
      name: item.name,
      score: item.score,
      category: item.category,
    }))
  const semanticEvidence = toSemanticEvidenceStatus(await deps.index.getStatus({ probe: false }))

  return {
    ok: true,
    data: {
      candidates,
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'search_semantic_pois',
      audited: false,
    },
  }
}
