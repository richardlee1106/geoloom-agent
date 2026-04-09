import { randomUUID } from 'node:crypto'

import { toSemanticEvidenceStatus } from '../../../integration/dependencyStatus.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'
import type { RegionFeatureTag, RegionSnapshotInput } from '../../../chat/types.js'
import type { SkillExecutionResult } from '../../types.js'
import type { VectorRecord } from './encodeQuery.js'

export async function encodeRegionSnapshotAction(
  payload: { snapshot?: RegionSnapshotInput },
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
  feature_tags: RegionFeatureTag[]
}>> {
  const snapshot = payload.snapshot || {}
  const encoded = await deps.bridge.encodeRegionSnapshot(snapshot)
  const semanticEvidence = toSemanticEvidenceStatus(await deps.bridge.getStatus())
  const embeddingId = `region_${randomUUID()}`
  const vectorRef = `vector:region:${embeddingId}`
  deps.store.set(vectorRef, {
    id: embeddingId,
    ref: vectorRef,
    vector: encoded.vector,
    source: encoded.summary || snapshot.subjectName || snapshot.anchorName || 'region_snapshot',
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
      action: 'encode_region_snapshot',
      audited: false,
    },
  }
}
