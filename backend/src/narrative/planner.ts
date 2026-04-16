import type { EvidenceItem, RegionFeatureTag } from '../chat/types.js'
import { classifyRepresentativeAnchorType } from '../evidence/areaInsight/representativeAnchorPriority.js'
import type {
  NarrativeNode,
  NarrativeTourStep,
  NarrativeTourTransition,
  NarrativeViewportSummary,
} from './types.js'

function normalizeName(value: unknown) {
  return String(value || '').trim()
}

function haversine(left: { lon: number, lat: number }, right: { lon: number, lat: number }) {
  const dLat = (right.lat - left.lat) * Math.PI / 180
  const dLon = (right.lon - left.lon) * Math.PI / 180
  const lat1 = left.lat * Math.PI / 180
  const lat2 = right.lat * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function resolveRoleLabel(role: string) {
  if (role === 'scenic_landmark') return '景区地标'
  if (role === 'campus_anchor') return '高校锚点'
  if (role === 'commercial_anchor') return '商业街区'
  if (role === 'transit_connector') return '交通节点'
  if (role === 'local_life_anchor') return '本地生活'
  return '片区节点'
}

function resolveRoleWeight(role: string) {
  if (role === 'scenic_landmark') return 0.96
  if (role === 'campus_anchor') return 0.9
  if (role === 'commercial_anchor') return 0.84
  if (role === 'local_life_anchor') return 0.78
  if (role === 'transit_connector') return 0.6
  return 0.52
}

function resolveNodeRoleFromPoi(item: EvidenceItem) {
  const anchorType = classifyRepresentativeAnchorType({
    name: item.name,
    categoryMain: item.categoryMain,
    categorySub: item.categorySub || item.category,
    allowNameFallback: false,
  })
  if (anchorType === 'scenic') return 'scenic_landmark'
  if (anchorType === 'campus') return 'campus_anchor'
  if (anchorType === 'commercial') return 'commercial_anchor'
  if (anchorType === 'station') return 'transit_connector'
  if (/(餐饮|生活服务|住宿服务|购物服务|便利店)/u.test(`${item.categoryMain || ''} ${item.categorySub || ''}`)) {
    return 'local_life_anchor'
  }
  return 'district_anchor'
}

function resolveNodeRoleFromAoi(item: Record<string, unknown>) {
  const anchorType = classifyRepresentativeAnchorType({
    name: normalizeName(item.name),
    fclass: String(item.fclass || '').trim() || null,
  })
  if (anchorType === 'scenic') return 'scenic_landmark'
  if (anchorType === 'campus') return 'campus_anchor'
  if (anchorType === 'commercial') return 'commercial_anchor'
  if (anchorType === 'station') return 'transit_connector'
  return 'district_anchor'
}

function inferSceneMix(input: {
  featureTags: RegionFeatureTag[]
  encoderSceneTags?: string[]
  candidates: NarrativeNode[]
}) {
  const mix = new Set<string>()
  const rawSceneTags = input.encoderSceneTags || []
  if (rawSceneTags.some((tag) => /(water|park|scenic|tour|滨水|景观|公园|风景)/iu.test(tag))) mix.add('景观地标')
  if (input.featureTags.some((tag) => tag.key === 'campus_anchor')) mix.add('高校')
  if (input.featureTags.some((tag) => tag.key === 'commercial_vitality')) mix.add('商业休闲')
  if (input.featureTags.some((tag) => tag.key === 'mixed_use' || tag.key === 'residential_support')) mix.add('本地生活')
  if (input.featureTags.some((tag) => tag.key === 'transit_connected')) mix.add('交通接驳')
  if (input.candidates.some((item) => item.role === 'scenic_landmark')) mix.add('景观地标')
  if (input.candidates.some((item) => item.role === 'campus_anchor')) mix.add('高校')
  if (input.candidates.some((item) => item.role === 'commercial_anchor')) mix.add('商业休闲')
  if (input.candidates.some((item) => item.role === 'local_life_anchor')) mix.add('本地生活')
  return [...mix]
}

export function buildNarrativeViewportSummary(input: {
  featureTags: RegionFeatureTag[]
  featureSummary: string
  encoderSummary?: string | null
  encoderTags?: RegionFeatureTag[]
  encoderSceneTags?: string[]
  encoderDominantBuckets?: string[]
  candidates: NarrativeNode[]
}) {
  const sceneMix = inferSceneMix({
    featureTags: input.featureTags,
    encoderSceneTags: input.encoderSceneTags,
    candidates: input.candidates,
  })
  const dominantScene = sceneMix[0] || '混合片区'
  const summarySentence = input.encoderSummary
    || (sceneMix.length > 0
      ? `这片区域更像一个${sceneMix.join(' + ')}叠加的混合片区，适合按代表地标到生活节点的顺序展开。`
      : input.featureSummary)

  const summary: NarrativeViewportSummary = {
    dominantScene,
    sceneMix,
    summarySentence,
    featureTags: input.featureTags,
    encoderSummary: input.encoderSummary || null,
    encoderTags: input.encoderTags || [],
    sceneTags: input.encoderSceneTags || [],
    dominantBuckets: input.encoderDominantBuckets || [],
  }

  return summary
}

export function buildNarrativeCandidates(input: {
  representativeSamples: EvidenceItem[]
  aoiContext: Record<string, unknown>[]
}) {
  const nodes: NarrativeNode[] = []

  for (const item of input.representativeSamples) {
    if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) continue
    const role = resolveNodeRoleFromPoi(item)
    const distancePenalty = Number.isFinite(Number(item.distance_m)) ? Math.min(Number(item.distance_m) / 12000, 0.22) : 0
    nodes.push({
      id: `poi:${String(item.id ?? item.name)}`,
      name: normalizeName(item.name),
      role,
      roleLabel: resolveRoleLabel(role),
      source: 'representative_sample',
      center: { lon: Number(item.longitude), lat: Number(item.latitude) },
      score: Number((resolveRoleWeight(role) + 0.18 - distancePenalty).toFixed(3)),
      categoryMain: item.categoryMain || null,
      categorySub: item.categorySub || item.category || null,
      distanceM: Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : null,
      tags: [role, String(item.categoryMain || ''), String(item.categorySub || item.category || '')].filter(Boolean),
      reasons: [resolveRoleLabel(role), String(item.categorySub || item.categoryMain || '空间代表点')].filter(Boolean),
    })
  }

  for (const item of input.aoiContext) {
    const name = normalizeName(item.name)
    if (!name) continue
    const lon = Number(item.longitude)
    const lat = Number(item.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const role = resolveNodeRoleFromAoi(item)
    const weight = Number(item.population || item.area_sqm || item.areaSqm || 1)
    const scaleBonus = Math.min(Math.log10(Math.max(weight, 1) + 1) / 10, 0.18)
    nodes.push({
      id: `aoi:${String(item.id ?? name)}`,
      name,
      role,
      roleLabel: resolveRoleLabel(role),
      source: 'aoi_context',
      center: { lon, lat },
      score: Number((resolveRoleWeight(role) + 0.24 + scaleBonus).toFixed(3)),
      categoryMain: null,
      categorySub: String(item.fclass || '').trim() || null,
      distanceM: null,
      tags: [role, String(item.fclass || '')].filter(Boolean),
      reasons: [resolveRoleLabel(role), 'AOI 代表锚点'].filter(Boolean),
    })
  }

  const deduped = new Map<string, NarrativeNode>()
  for (const node of nodes.sort((left, right) => right.score - left.score)) {
    const key = node.name.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, node)
    }
  }

  return [...deduped.values()].sort((left, right) => right.score - left.score)
}

function resolveNarrativeMode(summary: NarrativeViewportSummary) {
  if (summary.sceneMix.includes('景观地标')) return 'landmark_to_life'
  if (summary.sceneMix.includes('高校')) return 'campus_to_commerce'
  return 'district_sweep'
}

function resolveRoleOrder(mode: string) {
  if (mode === 'campus_to_commerce') return ['campus_anchor', 'scenic_landmark', 'commercial_anchor', 'local_life_anchor', 'transit_connector', 'district_anchor']
  if (mode === 'district_sweep') return ['commercial_anchor', 'district_anchor', 'local_life_anchor', 'campus_anchor', 'scenic_landmark', 'transit_connector']
  return ['scenic_landmark', 'campus_anchor', 'commercial_anchor', 'local_life_anchor', 'transit_connector', 'district_anchor']
}

export function rankNarrativeNodes(candidates: NarrativeNode[], summary: NarrativeViewportSummary, limit = 5) {
  const mode = resolveNarrativeMode(summary)
  const roleOrder = resolveRoleOrder(mode)
  const selected: NarrativeNode[] = []
  const roleCounts = new Map<string, number>()

  for (const role of roleOrder) {
    const next = candidates.find((node) => node.role === role && !selected.some((item) => item.id === node.id))
    if (next) {
      selected.push(next)
      roleCounts.set(role, 1)
    }
    if (selected.length >= limit) break
  }

  for (const candidate of candidates) {
    if (selected.length >= limit) break
    if (selected.some((item) => item.id === candidate.id)) continue
    const count = roleCounts.get(candidate.role) || 0
    if (count >= 2) continue
    const tooClose = selected.some((item) => item.role === candidate.role && haversine(item.center, candidate.center) < 450)
    if (tooClose) continue
    selected.push(candidate)
    roleCounts.set(candidate.role, count + 1)
  }

  return {
    narrativeMode: mode,
    selectedNodes: selected.sort((left, right) => roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role) || right.score - left.score),
  }
}

function buildTransitionRationale(from: NarrativeNode, to: NarrativeNode) {
  if (from.role === 'scenic_landmark' && to.role === 'campus_anchor') return '从地标景观切到高校锚点，补足这片区域的人文与日常使用场景。'
  if (from.role === 'campus_anchor' && to.role === 'commercial_anchor') return '从高校人流延伸到商业承接区，能看出消费与活动如何外溢。'
  if (from.role === 'commercial_anchor' && to.role === 'local_life_anchor') return '从显性的商业活力转到更贴近日常生活的街区，叙事会更落地。'
  if (to.role === 'transit_connector') return '最后补一个交通节点，方便理解这片区域的人流组织方式。'
  return `从${from.roleLabel}切到${to.roleLabel}，让片区结构更完整。`
}

export function buildNarrativeTransitions(nodes: NarrativeNode[]) {
  const transitions: NarrativeTourTransition[] = []
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes[index - 1]
    const to = nodes[index]
    transitions.push({
      fromId: from.id,
      toId: to.id,
      rationale: buildTransitionRationale(from, to),
    })
  }
  return transitions
}

function buildNodeVoiceText(node: NarrativeNode, transition?: NarrativeTourTransition | null) {
  const intro = transition ? `${transition.rationale} 接着看 ${node.name}。` : `先看 ${node.name}。`
  const categoryText = node.categorySub || node.categoryMain || node.roleLabel
  return `${intro} 这个节点更像当前区域里的${node.roleLabel}，也是理解整片区域“${categoryText}”气质的代表点。`
}

export function buildNarrativeSteps(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
}) {
  const steps: NarrativeTourStep[] = [
    {
      focus: 'overview',
      voice_text: input.summary.summarySentence,
      duration: 4200,
    },
  ]

  for (let index = 0; index < input.nodes.length; index += 1) {
    const node = input.nodes[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    steps.push({
      focus: node.name,
      voice_text: buildNodeVoiceText(node, transition),
      duration: 5000,
      center: node.center,
      node_id: node.id,
      role: node.role,
      transition_reason: transition?.rationale,
    })
  }

  return steps
}

export function buildNarrativeAnswer(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
}) {
  const lines = [
    '## 当前视口画像',
    input.summary.summarySentence,
    '',
    '## 第一版导览顺序',
  ]

  input.nodes.forEach((node, index) => {
    lines.push(`${index + 1}. **${node.name}** · ${node.roleLabel}`)
    lines.push(`   - 代表理由：${node.reasons.join(' / ')}`)
    if (index > 0) {
      lines.push(`   - 转场逻辑：${input.transitions[index - 1]?.rationale || '承接上一节点继续展开。'}`)
    }
  })

  lines.push('')
  lines.push('## 编排方式')
  lines.push(`当前采用 **${input.narrativeMode}** 顺序，把区域地标、功能锚点和生活节点串成一条可播放的导览骨架。`)
  return lines.join('\n')
}
