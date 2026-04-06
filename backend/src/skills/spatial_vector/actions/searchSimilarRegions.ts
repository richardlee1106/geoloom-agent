import type { SkillExecutionResult } from '../../types.js'
import type { FaissIndex } from '../../../integration/faissIndex.js'

export async function searchSimilarRegionsAction(
  payload: { text: string, top_k?: number },
  deps: { index: FaissIndex },
): Promise<SkillExecutionResult<{
  regions: Array<{ region_id: string, name: string, score: number, summary: string }>
}>> {
  const regions = (await deps.index.searchSimilarRegions(payload.text, payload.top_k || 5))
    .map((item) => ({
      region_id: item.id,
      name: item.name,
      score: item.score,
      summary: item.summary,
    }))

  return {
    ok: true,
    data: { regions },
    meta: {
      action: 'search_similar_regions',
      audited: false,
    },
  }
}
