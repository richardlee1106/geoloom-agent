import { randomUUID } from 'node:crypto'

import type { SemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { SkillExecutionResult } from '../../types.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { VectorRecord } from './encodeQuery.js'

export async function encodeRegionAction(
  payload: { label?: string, text?: string },
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
  const text = payload.label || payload.text || ''
  const encoded = await deps.bridge.encodeText(text)
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))
  const embeddingId = `region_${randomUUID()}`
  const vectorRef = `vector:region:${embeddingId}`
  deps.store.set(vectorRef, {
    id: embeddingId,
    ref: vectorRef,
    vector: encoded.vector,
    source: text,
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
      action: 'encode_region',
      audited: false,
    },
  }
}
