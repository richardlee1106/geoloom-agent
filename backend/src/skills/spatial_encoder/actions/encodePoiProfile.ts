import { randomUUID } from 'node:crypto'

import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { PoiFeatureTag, PoiProfileInput } from '../../../chat/types.js'
import type { SkillExecutionResult } from '../../types.js'
import type { VectorRecord } from './encodeQuery.js'

export async function encodePoiProfileAction(
  payload: { profile?: PoiProfileInput },
  deps: {
    bridge: PythonBridge
    store: Map<string, VectorRecord>
  },
): Promise<SkillExecutionResult<{
  embedding_id: string
  vector_dim: number
  vector_ref: string
  semantic_evidence: ReturnType<typeof toSemanticEvidenceStatus>
  feature_summary: string
  feature_tags: PoiFeatureTag[]
}>> {
  const profile = payload.profile || { name: '' }
  const encoded = await deps.bridge.encodePoiProfile(profile)
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus({ probe: false }))
  const embeddingId = `poi_${randomUUID()}`
  const vectorRef = `vector:poi:${embeddingId}`
  deps.store.set(vectorRef, {
    id: embeddingId,
    ref: vectorRef,
    vector: encoded.vector,
    source: encoded.summary || profile.name || 'poi_profile',
    semanticEvidence,
  })

  return {
    ok: true,
    data: {
      embedding_id: embeddingId,
      vector_dim: encoded.dimension,
      vector_ref: vectorRef,
      semantic_evidence: semanticEvidence,
      feature_summary: encoded.summary,
      feature_tags: encoded.feature_tags || [],
    },
    meta: {
      action: 'encode_poi_profile',
      audited: false,
    },
  }
}
