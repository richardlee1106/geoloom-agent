import type { SkillExecutionResult } from '../../types.js'
import type { FaissIndex } from '../../../integration/faissIndex.js'

export async function searchSemanticPOIsAction(
  payload: { text: string, top_k?: number },
  deps: { index: FaissIndex },
): Promise<SkillExecutionResult<{
  candidates: Array<{ poi_id: string, name: string, score: number, category: string }>
}>> {
  const candidates = (await deps.index.searchSemanticPOIs(payload.text, payload.top_k || 5))
    .map((item) => ({
      poi_id: item.id,
      name: item.name,
      score: item.score,
      category: item.category,
    }))

  return {
    ok: true,
    data: { candidates },
    meta: {
      action: 'search_semantic_pois',
      audited: false,
    },
  }
}
