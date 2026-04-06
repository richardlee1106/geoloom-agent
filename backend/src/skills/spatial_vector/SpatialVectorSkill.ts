import type { DependencyStatus } from '../../integration/dependencyStatus.js'
import { LocalFaissIndex, type FaissIndex } from '../../integration/faissIndex.js'
import type { SkillActionDefinition, SkillDefinition, SkillExecutionResult } from '../types.js'
import { searchSemanticPOIsAction } from './actions/searchSemanticPOIs.js'
import { searchSimilarRegionsAction } from './actions/searchSimilarRegions.js'

const actions: Record<string, SkillActionDefinition> = {
  search_semantic_pois: {
    name: 'search_semantic_pois',
    description: '根据空间语义描述召回 POI 候选',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        top_k: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        candidates: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  search_similar_regions: {
    name: 'search_similar_regions',
    description: '召回和给定描述相似的片区',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        top_k: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        regions: { type: 'array', items: { type: 'object' } },
      },
    },
  },
}

export function createSpatialVectorSkill(options: {
  index?: FaissIndex
} = {}): SkillDefinition {
  const index = options.index || new LocalFaissIndex()

  return {
    name: 'spatial_vector',
    description: '空间向量召回技能，负责 semantic poi 和 similar region 检索',
    capabilities: ['search_semantic_pois', 'search_similar_regions'],
    actions,
    async getStatus(): Promise<Record<string, DependencyStatus>> {
      return {
        spatial_vector: await index.getStatus(),
      }
    },
    async execute(action, payload): Promise<SkillExecutionResult> {
      switch (action) {
        case 'search_semantic_pois':
          return searchSemanticPOIsAction(payload as { text: string, top_k?: number }, { index })
        case 'search_similar_regions':
          return searchSimilarRegionsAction(payload as { text: string, top_k?: number }, { index })
        default:
          return {
            ok: false,
            error: {
              code: 'unsupported_action',
              message: `Unknown spatial_vector action "${action}"`,
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
