import type { LODLevel, NarrativeResponse, NarrativeRouteStrategy, StoryTag } from './contract.js'
import type { RegionRelationType } from './regionRelations.js'

export interface NarrativeViewportExpectation {
  lod?: LODLevel
  minCandidateCount?: number
  minPathNodes?: number
  maxPathNodes?: number
  expectedRegionNames?: string[]
  forbiddenRegionPattern?: RegExp
  allowedStrategies?: NarrativeRouteStrategy[]
  requiredStoryTags?: StoryTag[]
  minStoryTagCount?: number
  requiredRelationTypes?: RegionRelationType[]
  minRelationTypeCount?: number
  minSemanticDiversity?: number
  minWebSourceCount?: number
}

export interface NarrativeViewportEvaluation {
  name: string
  passed: boolean
  failures: string[]
  metrics: {
    lod: LODLevel
    strategy?: NarrativeRouteStrategy
    candidate_count: number
    path_node_count: number
    story_tag_count: number
    relation_type_count: number
    web_source_count: number
    semantic_diversity: number
  }
}

export function evaluateNarrativeViewport(name: string, response: NarrativeResponse, expectation: NarrativeViewportExpectation): NarrativeViewportEvaluation {
  const failures: string[] = []
  const regionNames = response.regions.map((region) => region.display_name)
  const storyTags = new Set(response.story_tags || response.path.story_tags || [])
  const relationTypes = extractRelationTypes(response)
  const webSourceCount = response.narration.chapters.reduce((sum, chapter) => sum + (chapter.web_sources?.length || 0), 0)

  if (expectation.lod && response.lod !== expectation.lod) failures.push(`LOD 应为 ${expectation.lod}，实际为 ${response.lod}`)
  if (expectation.minCandidateCount !== undefined && response.candidate_count < expectation.minCandidateCount) failures.push(`候选数应不少于 ${expectation.minCandidateCount}，实际为 ${response.candidate_count}`)
  if (expectation.minPathNodes !== undefined && response.path.nodes.length < expectation.minPathNodes) failures.push(`路径节点数应不少于 ${expectation.minPathNodes}，实际为 ${response.path.nodes.length}`)
  if (expectation.maxPathNodes !== undefined && response.path.nodes.length > expectation.maxPathNodes) failures.push(`路径节点数应不多于 ${expectation.maxPathNodes}，实际为 ${response.path.nodes.length}`)
  for (const expectedName of expectation.expectedRegionNames || []) {
    if (!regionNames.some((nameItem) => nameItem === expectedName || nameItem.startsWith(expectedName))) failures.push(`缺少预期片区 ${expectedName}`)
  }
  if (expectation.forbiddenRegionPattern && regionNames.some((nameItem) => expectation.forbiddenRegionPattern?.test(nameItem))) failures.push(`片区命中禁用模式 ${expectation.forbiddenRegionPattern.source}`)
  if (expectation.allowedStrategies?.length && (!response.path.strategy || !expectation.allowedStrategies.includes(response.path.strategy))) failures.push(`策略 ${response.path.strategy || '未设置'} 不在允许矩阵内`)
  for (const tag of expectation.requiredStoryTags || []) {
    if (!storyTags.has(tag)) failures.push(`缺少叙事标签 ${tag}`)
  }
  if (expectation.minStoryTagCount !== undefined && storyTags.size < expectation.minStoryTagCount) failures.push(`叙事标签数应不少于 ${expectation.minStoryTagCount}，实际为 ${storyTags.size}`)
  for (const relationType of expectation.requiredRelationTypes || []) {
    if (!relationTypes.has(relationType)) failures.push(`缺少关系类型 ${relationType}`)
  }
  if (expectation.minRelationTypeCount !== undefined && relationTypes.size < expectation.minRelationTypeCount) failures.push(`关系类型数应不少于 ${expectation.minRelationTypeCount}，实际为 ${relationTypes.size}`)
  if (expectation.minSemanticDiversity !== undefined && response.semantic_diversity < expectation.minSemanticDiversity) failures.push(`语义多样性应不少于 ${expectation.minSemanticDiversity}，实际为 ${response.semantic_diversity}`)
  if (expectation.minWebSourceCount !== undefined && webSourceCount < expectation.minWebSourceCount) failures.push(`网页来源数应不少于 ${expectation.minWebSourceCount}，实际为 ${webSourceCount}`)

  return {
    name,
    passed: failures.length === 0,
    failures,
    metrics: {
      lod: response.lod,
      strategy: response.path.strategy,
      candidate_count: response.candidate_count,
      path_node_count: response.path.nodes.length,
      story_tag_count: storyTags.size,
      relation_type_count: relationTypes.size,
      web_source_count: webSourceCount,
      semantic_diversity: response.semantic_diversity,
    },
  }
}

export function summarizeNarrativeViewportEvaluations(evaluations: NarrativeViewportEvaluation[]): {
  total: number
  passed: number
  failed: number
  failures: Array<{ name: string; failures: string[] }>
  metrics: NarrativeViewportEvaluation['metrics'][]
} {
  return {
    total: evaluations.length,
    passed: evaluations.filter((item) => item.passed).length,
    failed: evaluations.filter((item) => !item.passed).length,
    failures: evaluations.filter((item) => !item.passed).map((item) => ({ name: item.name, failures: item.failures })),
    metrics: evaluations.map((item) => item.metrics),
  }
}

function extractRelationTypes(response: NarrativeResponse): Set<RegionRelationType> {
  const relations = response.debug?.path && typeof response.debug.path === 'object'
    ? (response.debug.path as { relations?: Array<{ type?: unknown }> }).relations
    : undefined
  return new Set((relations || []).map((relation) => relation.type).filter((type): type is RegionRelationType => typeof type === 'string'))
}
