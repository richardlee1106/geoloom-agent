import type { DependencyStatus } from '../../integration/dependencyStatus.js'
import { LocalPythonBridge, type PythonBridge } from '../../integration/pythonBridge.js'
import type { PoiProfileInput, RegionSnapshotInput } from '../../chat/types.js'
import type { SkillActionDefinition, SkillDefinition, SkillExecutionResult } from '../types.js'
import { encodeQueryAction, type VectorRecord } from './actions/encodeQuery.js'
import { encodePoiProfileAction } from './actions/encodePoiProfile.js'
import { encodeRegionAction } from './actions/encodeRegion.js'
import { encodeRegionSnapshotAction } from './actions/encodeRegionSnapshot.js'
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
        semantic_evidence: {
          type: 'object',
          properties: {
            dependency: { type: 'string' },
            level: { type: 'string' },
            weakEvidence: { type: 'boolean' },
            mode: { type: 'string' },
            reason: { type: 'string' },
            target: { type: 'string' },
          },
        },
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
        semantic_evidence: {
          type: 'object',
          properties: {
            dependency: { type: 'string' },
            level: { type: 'string' },
            weakEvidence: { type: 'boolean' },
            mode: { type: 'string' },
            reason: { type: 'string' },
            target: { type: 'string' },
          },
        },
      },
    },
  },
  encode_region_snapshot: {
    name: 'encode_region_snapshot',
    description: '将区域结构化快照编码成片区特征向量与特征标签',
    inputSchema: {
      type: 'object',
      required: ['snapshot'],
      properties: {
        snapshot: {
          type: 'object',
          properties: {
            anchorName: { type: 'string' },
            subjectName: { type: 'string' },
            rawQuery: { type: 'string' },
            dominantCategories: { type: 'array', items: { type: 'object' } },
            ringDistribution: { type: 'array', items: { type: 'object' } },
            hotspots: { type: 'array', items: { type: 'object' } },
            representativePois: { type: 'array', items: { type: 'object' } },
            aoiContext: { type: 'array', items: { type: 'object' } },
            landuseContext: { type: 'array', items: { type: 'object' } },
            competitionDensity: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        embedding_id: { type: 'string' },
        vector_dim: { type: 'number' },
        vector_ref: { type: 'string' },
        feature_summary: { type: 'string' },
        feature_tags: { type: 'array', items: { type: 'object' } },
        semantic_evidence: {
          type: 'object',
          properties: {
            dependency: { type: 'string' },
            level: { type: 'string' },
            weakEvidence: { type: 'boolean' },
            mode: { type: 'string' },
            reason: { type: 'string' },
            target: { type: 'string' },
          },
        },
      },
    },
  },
  encode_poi_profile: {
    name: 'encode_poi_profile',
    description: '将代表 POI 的结构化档案编码成角色特征向量与角色标签',
    inputSchema: {
      type: 'object',
      required: ['profile'],
      properties: {
        profile: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            categoryMain: { type: 'string' },
            categorySub: { type: 'string' },
            distanceM: { type: 'number' },
            areaSubject: { type: 'string' },
            hotspotLabel: { type: 'string' },
            surroundingCategories: { type: 'array', items: { type: 'string' } },
            aoiContext: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        embedding_id: { type: 'string' },
        vector_dim: { type: 'number' },
        vector_ref: { type: 'string' },
        feature_summary: { type: 'string' },
        feature_tags: { type: 'array', items: { type: 'object' } },
        semantic_evidence: {
          type: 'object',
          properties: {
            dependency: { type: 'string' },
            level: { type: 'string' },
            weakEvidence: { type: 'boolean' },
            mode: { type: 'string' },
            reason: { type: 'string' },
            target: { type: 'string' },
          },
        },
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
        semantic_evidence: {
          type: 'object',
          properties: {
            dependency: { type: 'string' },
            level: { type: 'string' },
            weakEvidence: { type: 'boolean' },
            mode: { type: 'string' },
            reason: { type: 'string' },
            target: { type: 'string' },
          },
        },
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
    capabilities: ['encode_query', 'encode_region', 'encode_region_snapshot', 'encode_poi_profile', 'score_similarity'],
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
        case 'encode_region_snapshot':
          return encodeRegionSnapshotAction(payload as { snapshot?: RegionSnapshotInput }, { bridge, store })
        case 'encode_poi_profile':
          return encodePoiProfileAction(payload as { profile?: PoiProfileInput }, { bridge, store })
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
