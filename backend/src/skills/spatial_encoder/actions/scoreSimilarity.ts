import type { SemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import { mergeSemanticEvidenceStatuses } from '../../../integration/dependencyStatus.js'
import type { SkillExecutionResult } from '../../types.js'
import type { VectorRecord } from './encodeQuery.js'

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] ** 2
    normB += b[index] ** 2
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function scoreSimilarityAction(
  payload: { query_vector_ref: string, candidate_vector_refs: string[] },
  deps: {
    store: Map<string, VectorRecord>
  },
): SkillExecutionResult<{
  scores: Array<{ candidate_id: string, score: number }>
  semantic_evidence?: SemanticEvidenceStatus
}> {
  const query = deps.store.get(payload.query_vector_ref)
  if (!query) {
    return {
      ok: false,
      error: {
        code: 'missing_query_vector',
        message: 'Query vector reference not found',
      },
      meta: {
        action: 'score_similarity',
        audited: false,
      },
    }
  }

  const scores = payload.candidate_vector_refs
    .map((vectorRef) => deps.store.get(vectorRef))
    .filter((item): item is VectorRecord => Boolean(item))
    .map((candidate) => ({
      candidate_id: candidate.ref,
      score: Number(cosineSimilarity(query.vector, candidate.vector).toFixed(4)),
    }))
    .sort((a, b) => b.score - a.score)
  const matchedCandidates = payload.candidate_vector_refs
    .map((vectorRef) => deps.store.get(vectorRef))
    .filter((item): item is VectorRecord => Boolean(item))
  const semanticEvidence = mergeSemanticEvidenceStatuses([
    query.semanticEvidence,
    ...matchedCandidates.map((candidate) => candidate.semanticEvidence),
  ])

  return {
    ok: true,
    data: {
      scores,
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'score_similarity',
      audited: false,
    },
  }
}
