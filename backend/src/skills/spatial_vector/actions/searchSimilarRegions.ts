import type { SemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { SkillExecutionResult } from '../../types.js'
import type { FaissIndex } from '../../../integration/faissIndex.js'

export async function searchSimilarRegionsAction(
  payload: { text: string, top_k?: number },
  deps: { index: FaissIndex },
): Promise<SkillExecutionResult<{
  regions: Array<{ region_id: string, name: string, score: number, summary: string, tags?: string[] }>
  semantic_evidence: SemanticEvidenceStatus
}>> {
  const regions = (await deps.index.searchSimilarRegions(payload.text, payload.top_k || 5))
    .map((item) => ({
      region_id: item.id,
      name: item.name,
      score: item.score,
      summary: item.summary,
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    }))
  const semanticEvidence = toSemanticEvidenceStatus(await deps.index.getStatus({ probe: false }))

  return {
    ok: true,
    data: {
      regions,
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'search_similar_regions',
      audited: false,
    },
  }
}
