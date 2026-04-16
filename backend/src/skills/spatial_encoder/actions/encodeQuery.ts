import { randomUUID } from 'node:crypto'

import type { SemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { SkillExecutionResult } from '../../types.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'

export interface VectorRecord {
  id: string
  ref: string
  vector: number[]
  source: string
  semanticEvidence: SemanticEvidenceStatus
}

export async function encodeQueryAction(
  payload: { text: string },
  deps: {
    bridge: PythonBridge
    store: Map<string, VectorRecord>
  },
): Promise<SkillExecutionResult<{
  embedding_id: string
  vector_dim: number
  vector_ref: string
  semantic_evidence: SemanticEvidenceStatus
}>> {
  const encoded = await deps.bridge.encodeText(payload.text)
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))
  const embeddingId = `query_${randomUUID()}`
  const vectorRef = `vector:query:${embeddingId}`
  deps.store.set(vectorRef, {
    id: embeddingId,
    ref: vectorRef,
    vector: encoded.vector,
    source: payload.text,
    semanticEvidence,
  })

  return {
    ok: true,
    data: {
      embedding_id: embeddingId,
      vector_dim: encoded.dimension,
      vector_ref: vectorRef,
      semantic_evidence: semanticEvidence,
    },
    meta: {
      action: 'encode_query',
      audited: false,
    },
  }
}
