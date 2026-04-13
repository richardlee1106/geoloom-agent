/**
 * 确定性证据选择器。
 * 阶段 4：从 NLContract.meta.depth 直接推导需要调用的原子探针列表。
 */
import type { NLContract } from '../contract/types.js'
import type { DeterministicIntent } from '../chat/types.js'
import type { EvidenceAtom, AtomExecutionSpec } from './atoms.js'

export interface ResolvedRequirements {
  requiredAtoms: EvidenceAtom[]
  optionalAtoms: EvidenceAtom[]
  executionSpecs: AtomExecutionSpec[]
  confidence: 'high' | 'medium' | 'low'
  /** 建议走 Fast Track 还是 Deep Track */
  recommendedTrack: 'fast' | 'deep'
}

export class RequirementResolver {
  resolve(input: {
    contract: NLContract
    intent: DeterministicIntent
  }): ResolvedRequirements {
    const { depth, needsWebEvidence, webSearchStrategy } = input.contract.meta
    const { queryType } = input.intent

    // lookup 型：最小集 + 联网搜索（如有需要）
    if (depth === 'lookup') {
      const lookupWebDeps: EvidenceAtom[] = input.intent.anchorSource === 'map_view'
        ? ['area.aoi_context']
        : []
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, lookupWebDeps)
      if (queryType === 'nearest_station') {
        return this.buildResult(['anchor.resolved', 'poi.nearest_station', ...webAtoms.required], webAtoms.optional, 'fast', input.intent)
      }
      return this.buildResult(['anchor.resolved', 'poi.nearby_list', ...webAtoms.required], webAtoms.optional, 'fast', input.intent)
    }

    // compare 型
    if (queryType === 'compare_places') {
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, ['anchor.resolved'])
      return this.buildResult(
        ['anchor.resolved', 'anchor.secondary_resolved', 'compare.pairs', ...webAtoms.required],
        webAtoms.optional,
        'fast',
        input.intent,
      )
    }

    // similar_regions 型
    if (queryType === 'similar_regions') {
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, ['area.category_histogram'])
      return this.buildResult(
        ['anchor.resolved', 'area.category_histogram', 'area.representative_samples', ...webAtoms.required],
        ['area.region_encoding', ...webAtoms.optional],
        'deep',
        input.intent,
      )
    }

    // descriptive 型
    if (depth === 'descriptive') {
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, ['area.representative_samples'])
      return this.buildResult(
        ['area.category_histogram', 'area.representative_samples', ...webAtoms.required],
        ['area.aoi_context', ...webAtoms.optional],
        'fast',
        input.intent,
      )
    }

    // structural 型
    if (depth === 'structural') {
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, ['area.representative_samples'])
      return this.buildResult(
        [
          'area.category_histogram',
          'area.representative_samples',
          'area.hotspots',
          'area.ring_distribution',
          'area.aoi_context',
          'area.landuse_context',
          ...webAtoms.required,
        ],
        ['area.region_encoding', ...webAtoms.optional],
        'fast',
        input.intent,
      )
    }

    // prescriptive 型
    if (depth === 'prescriptive') {
      const webAtoms = this.resolveWebAtoms(needsWebEvidence, webSearchStrategy, ['area.representative_samples'])
      return this.buildResult(
        [
          'area.category_histogram',
          'area.representative_samples',
          'area.hotspots',
          'area.competition_density',
          'area.aoi_context',
          'area.landuse_context',
          ...webAtoms.required,
        ],
        ['area.ring_distribution', 'area.region_encoding', ...webAtoms.optional],
        'fast',
        input.intent,
      )
    }

    // 兜底
    return this.buildResult(
      ['area.category_histogram', 'area.representative_samples'],
      [],
      'fast',
      input.intent,
    )
  }

  /**
   * 根据 webSearchStrategy 解析需要注入的 web atoms
   * 优先级：Multi Search（DDG主力，免费56%相关性）→ Tavily（后备）
   */
  private resolveWebAtoms(
    needsWebEvidence: boolean,
    webSearchStrategy: string,
    spatialDeps: EvidenceAtom[],
  ): { required: EvidenceAtom[], optional: EvidenceAtom[] } {
    if (!needsWebEvidence || webSearchStrategy === 'none') {
      return { required: [], optional: [] }
    }

    const required: EvidenceAtom[] = []
    const optional: EvidenceAtom[] = []

    for (const dep of spatialDeps) {
      if (!required.includes(dep)) {
        required.push(dep)
      }
    }

    switch (webSearchStrategy) {
      case 'tavily':
        required.push('web.tavily')
        required.push('web.entity_alignment')
        break
      case 'multi_search':
        required.push('web.multi_search')
        optional.push('web.tavily')
        required.push('web.entity_alignment')
        break
      case 'hybrid':
        required.push('web.multi_search')
        optional.push('web.tavily')
        required.push('web.entity_alignment')
        break
      case 'entity_alignment_only':
        // web search skills 不可用时的降级策略
        required.push('web.entity_alignment')
        break
    }

    return { required, optional }
  }

  private buildResult(
    required: EvidenceAtom[],
    optional: EvidenceAtom[],
    track: 'fast' | 'deep',
    intent: DeterministicIntent,
  ): ResolvedRequirements {
    const uniqueRequired = [...new Set(required)]
    const uniqueOptional = [...new Set(optional)].filter((atom) => !uniqueRequired.includes(atom))
    return {
      requiredAtoms: uniqueRequired,
      optionalAtoms: uniqueOptional,
      executionSpecs: this.buildSpecs(uniqueRequired, intent),
      confidence: track === 'fast' ? 'high' : 'medium',
      recommendedTrack: track,
    }
  }

  private buildSpecs(atoms: EvidenceAtom[], intent: DeterministicIntent): AtomExecutionSpec[] {
    // 每个 atom 映射到具体的 skill/action/template
    return atoms.map(atom => this.atomToSpec(atom, intent))
  }

  private atomToSpec(atom: EvidenceAtom, intent: DeterministicIntent): AtomExecutionSpec {
    const candidateReputationWebDeps: EvidenceAtom[] = (
      intent.queryType === 'nearby_poi'
      && intent.toolIntent === 'candidate_reputation'
    )
      ? ['poi.nearby_list']
      : []
    const ATOM_SPEC_MAP: Record<EvidenceAtom, Omit<AtomExecutionSpec, 'atom'>> = {
      'anchor.resolved': {
        skill: 'postgis', action: 'resolve_anchor',
        payloadTemplate: { role: 'primary' },
        dependsOn: [], parallelizable: false,
      },
      'anchor.secondary_resolved': {
        skill: 'postgis', action: 'resolve_anchor',
        payloadTemplate: { role: 'secondary' },
        dependsOn: [], parallelizable: true,
      },
      'poi.nearby_list': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'nearby_poi', limit: 10 },
        dependsOn: ['anchor.resolved'], parallelizable: false,
      },
      'poi.nearest_station': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'nearest_station', limit: 3 },
        dependsOn: ['anchor.resolved'], parallelizable: false,
      },
      'area.category_histogram': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_category_histogram', limit: 8 },
        dependsOn: [], parallelizable: true,
      },
      'area.representative_samples': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_representative_sample', limit: 18 },
        dependsOn: [], parallelizable: true,
      },
      'area.hotspots': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_h3_hotspots', limit: 5 },
        dependsOn: [], parallelizable: true,
      },
      'area.ring_distribution': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_ring_distribution', limit: 8 },
        dependsOn: [], parallelizable: true,
      },
      'area.competition_density': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_competition_density', limit: 8 },
        dependsOn: [], parallelizable: true,
      },
      'area.aoi_context': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_aoi_context', limit: 5 },
        dependsOn: [], parallelizable: true,
      },
      'area.landuse_context': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'area_landuse_context', limit: 6 },
        dependsOn: [], parallelizable: true,
      },
      'area.focused_samples': {
        skill: 'semantic_selector', action: 'select_area_evidence',
        payloadTemplate: {},
        dependsOn: ['area.category_histogram', 'area.representative_samples'],
        parallelizable: false,
      },
      'area.region_encoding': {
        skill: 'spatial_encoder', action: 'encode_region_snapshot',
        payloadTemplate: {},
        dependsOn: ['area.category_histogram', 'area.hotspots'],
        parallelizable: false,
      },
      'poi.profile_encoding': {
        skill: 'spatial_encoder', action: 'encode_poi_profile',
        payloadTemplate: {},
        dependsOn: ['area.representative_samples'],
        parallelizable: false,
      },
      'compare.pairs': {
        skill: 'postgis', action: 'execute_spatial_sql',
        payloadTemplate: { template: 'compare_places' },
        dependsOn: ['anchor.resolved', 'anchor.secondary_resolved'],
        parallelizable: false,
      },
      'web.multi_search': {
        skill: 'multi_search_engine', action: 'search_multi',
        payloadTemplate: { engine_type: 'auto', max_engines: 3 },
        dependsOn: [...new Set(['area.representative_samples', 'area.aoi_context', ...candidateReputationWebDeps])], parallelizable: true,
      },
      'web.tavily': {
        skill: 'tavily_search', action: 'search_web',
        payloadTemplate: { search_depth: 'basic', max_results: 10 },
        dependsOn: [...new Set(['area.representative_samples', 'area.aoi_context', ...candidateReputationWebDeps])], parallelizable: true,
      },
      'web.entity_alignment': {
        skill: 'entity_alignment', action: 'align_and_rank',
        payloadTemplate: { max_results: 20 },
        dependsOn: ['web.multi_search', 'poi.nearby_list', 'area.representative_samples'], parallelizable: false,
      },
    }

    return { atom, ...ATOM_SPEC_MAP[atom] }
  }
}
