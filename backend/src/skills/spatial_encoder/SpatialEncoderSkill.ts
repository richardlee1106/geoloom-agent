import type { DependencyStatus } from '../../integration/dependencyStatus.js'
import { LocalPythonBridge, type PythonBridge } from '../../integration/pythonBridge.js'
import type { SkillActionDefinition, SkillDefinition, SkillExecutionResult } from '../types.js'
import { encodeQueryAction, type VectorRecord } from './actions/encodeQuery.js'
import { encodeRegionAction } from './actions/encodeRegion.js'
import { scoreSimilarityAction } from './actions/scoreSimilarity.js'

const actions: Record<string, SkillActionDefinition> = {
  encode_query: {
    name: 'encode_query',
    description: '将空间描述编码成可复用向量引用',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        embedding_id: { type: 'string' },
        vector_dim: { type: 'number' },
        vector_ref: { type: 'string' },
      },
    },
  },
  encode_region: {
    name: 'encode_region',
    description: '将区域标签或描述编码成向量引用',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        text: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        embedding_id: { type: 'string' },
        vector_dim: { type: 'number' },
        vector_ref: { type: 'string' },
      },
    },
  },
  score_similarity: {
    name: 'score_similarity',
    description: '对查询向量和候选向量做相似度排序',
    inputSchema: {
      type: 'object',
      required: ['query_vector_ref', 'candidate_vector_refs'],
      properties: {
        query_vector_ref: { type: 'string' },
        candidate_vector_refs: { type: 'array', items: { type: 'string' } },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        scores: { type: 'array', items: { type: 'object' } },
      },
    },
  },
}

export function createSpatialEncoderSkill(options: {
  bridge?: PythonBridge
} = {}): SkillDefinition {
  const bridge = options.bridge || new LocalPythonBridge()
  const store = new Map<string, VectorRecord>()

  return {
    name: 'spatial_encoder',
    description: '空间语义编码技能，负责 query/region 编码和相似度评分',
    capabilities: ['encode_query', 'encode_region', 'score_similarity'],
    actions,
    async getStatus(): Promise<Record<string, DependencyStatus>> {
      return {
        spatial_encoder: await bridge.getStatus(),
      }
    },
    async execute(action, payload): Promise<SkillExecutionResult> {
      switch (action) {
        case 'encode_query':
          return encodeQueryAction(payload as { text: string }, { bridge, store })
        case 'encode_region':
          return encodeRegionAction(payload as { label?: string, text?: string }, { bridge, store })
        case 'score_similarity':
          return scoreSimilarityAction(payload as { query_vector_ref: string, candidate_vector_refs: string[] }, { store })
        default:
          return {
            ok: false,
            error: {
              code: 'unsupported_action',
              message: `Unknown spatial_encoder action "${action}"`,
            },
            meta: {
              action,
              audited: false,
            },
          }
      }
    },
  }
}
