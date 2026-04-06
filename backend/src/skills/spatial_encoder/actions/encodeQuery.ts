import { randomUUID } from 'node:crypto'

import type { SkillExecutionResult } from '../../types.js'
import type { PythonBridge } from '../../../integration/pythonBridge.js'

export interface VectorRecord {
  id: string
  ref: string
  vector: number[]
  source: string
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
}>> {
  const encoded = await deps.bridge.encodeText(payload.text)
  const embeddingId = `query_${randomUUID()}`
  const vectorRef = `vector:query:${embeddingId}`
  deps.store.set(vectorRef, {
    id: embeddingId,
    ref: vectorRef,
    vector: encoded.vector,
    source: payload.text,
  })

  return {
    ok: true,
    data: {
      embedding_id: embeddingId,
      vector_dim: encoded.dimension,
      vector_ref: vectorRef,
    },
    meta: {
      action: 'encode_query',
      audited: false,
    },
  }
}
