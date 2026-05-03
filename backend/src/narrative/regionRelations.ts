import { centerFromBoundary } from './geometry.js'
import type { RegionCandidate } from './regionCandidate.js'

export type RegionSemanticKind = 'education' | 'ecology' | 'commercial' | 'heritage' | 'transport' | 'civic' | 'mixed'

export type RegionRelationType =
  | 'spatial_nearby'
  | 'core_support'
  | 'functional_complement'
  | 'same_function'
  | 'entrance_gateway'
  | 'heritage_modern'

export interface RegionRelation {
  type: RegionRelationType
  strength: number
  reason: string
  evidence: string[]
}

const EDUCATION_RE = /(大学|学院|学校|校区|校园|图书馆|科技馆|文化馆|艺术馆|美术馆|研究院|科教|education|university|college|campus)/iu
const ECOLOGY_RE = /(公园|湖|山|江滩|湿地|绿道|景区|风景|生态|森林|游园|绿地|park|lake|riverfront|wetland)/iu
const COMMERCIAL_RE = /(商圈|商业|步行街|购物|商场|广场|万达|万象|天地|汉街|销品茂|餐饮|美食|小吃|咖啡|影院|娱乐|mall|plaza)/iu
const HERITAGE_RE = /(历史|老街|古迹|纪念馆|博物馆|昙华林|黎黄陂路|吉庆街|汉正街|水塔街|heritage|museum)/iu
const TRANSPORT_RE = /(地铁|车站|火车站|机场|码头|渡口|枢纽|公交|交通|站口|入口|出口|station|airport|terminal|metro)/iu
const CIVIC_RE = /(医院|政府|政务|服务中心|体育馆|体育场|会展|公共|hospital|civic|government)/iu

export function classifyRegionSemantic(candidate: RegionCandidate): RegionSemanticKind {
  const text = semanticText(candidate)
  const scores: Array<[RegionSemanticKind, number]> = [
    ['education', scorePattern(text, EDUCATION_RE)],
    ['ecology', scorePattern(text, ECOLOGY_RE)],
    ['commercial', scorePattern(text, COMMERCIAL_RE)],
    ['heritage', scorePattern(text, HERITAGE_RE)],
    ['transport', scorePattern(text, TRANSPORT_RE)],
    ['civic', scorePattern(text, CIVIC_RE)],
  ]
  const best = scores.sort((left, right) => right[1] - left[1])[0]
  return best && best[1] > 0 ? best[0] : 'mixed'
}

export function buildRegionRelation(previous: RegionCandidate, current: RegionCandidate): RegionRelation {
  const previousKind = classifyRegionSemantic(previous)
  const currentKind = classifyRegionSemantic(current)
  const evidence = [`${semanticLabel(previousKind)}→${semanticLabel(currentKind)}`]

  if (isTransportGateway(previousKind, currentKind)) {
    return {
      type: 'entrance_gateway',
      strength: 0.74,
      reason: `从${previous.display_name}转向${current.display_name}，相当于从交通入口进入这一带的主要活动腹地。`,
      evidence: [...evidence, '入口转场'],
    }
  }

  if (isHeritageModern(previousKind, currentKind)) {
    return {
      type: 'heritage_modern',
      strength: 0.76,
      reason: `从${previous.display_name}转到${current.display_name}，能把历史街区记忆和当代城市活力连起来看。`,
      evidence: [...evidence, '历史与现代'],
    }
  }

  if (isFunctionalComplement(previousKind, currentKind)) {
    return {
      type: 'functional_complement',
      strength: 0.82,
      reason: functionalComplementReason(previous, current, previousKind, currentKind),
      evidence: [...evidence, '功能互补'],
    }
  }

  if (isCoreSupportRelation(previous, current)) {
    return {
      type: 'core_support',
      strength: 0.78,
      reason: `从${previous.display_name}延伸到${current.display_name}，可以看到主体片区和周边支撑空间的关系。`,
      evidence: [...evidence, '主从角色'],
    }
  }

  if (previousKind === currentKind && previousKind !== 'mixed') {
    return {
      type: 'same_function',
      strength: 0.46,
      reason: `沿着同一类${semanticLabel(currentKind)}空间继续展开到${current.display_name}，保持讲解主题的连续性。`,
      evidence: [...evidence, '同类延展'],
    }
  }

  return {
    type: 'spatial_nearby',
    strength: 0.34,
    reason: `从${previous.display_name}顺着相邻空间转到${current.display_name}，让当前视野的空间关系逐步展开。`,
    evidence: [...evidence, `距离${formatDistanceKm(previous, current)}公里`],
  }
}

function semanticText(candidate: RegionCandidate): string {
  return [
    candidate.display_name,
    candidate.role,
    candidate.source,
    ...candidate.pois.slice(0, 80).flatMap((poi) => [poi.display_name, poi.category_main || '', poi.role]),
    ...candidate.narrative_facts.slice(0, 20).map((fact) => fact.claim),
  ].join(' ')
}

function scorePattern(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
  return matches?.length || 0
}

function isCoreSupportRelation(previous: RegionCandidate, current: RegionCandidate): boolean {
  return previous.role === 'primary_region'
    && (current.role === 'support_region' || current.role === 'landmark_anchor')
    && sameLocalContext(previous, current)
}

function sameLocalContext(previous: RegionCandidate, current: RegionCandidate): boolean {
  return distanceKm(previous, current) <= 2.2
}

function isTransportGateway(previousKind: RegionSemanticKind, currentKind: RegionSemanticKind): boolean {
  return previousKind === 'transport' && currentKind !== 'transport'
}

function isHeritageModern(previousKind: RegionSemanticKind, currentKind: RegionSemanticKind): boolean {
  return (previousKind === 'heritage' && currentKind === 'commercial') || (previousKind === 'commercial' && currentKind === 'heritage')
}

function isFunctionalComplement(previousKind: RegionSemanticKind, currentKind: RegionSemanticKind): boolean {
  const pair = new Set([previousKind, currentKind])
  if (pair.has('mixed')) return false
  return (pair.has('education') && pair.has('ecology'))
    || (pair.has('education') && pair.has('commercial'))
    || (pair.has('commercial') && pair.has('ecology'))
    || (pair.has('civic') && pair.has('commercial'))
    || (pair.has('civic') && pair.has('ecology'))
}

function functionalComplementReason(previous: RegionCandidate, current: RegionCandidate, previousKind: RegionSemanticKind, currentKind: RegionSemanticKind): string {
  const pair = new Set([previousKind, currentKind])
  if (pair.has('education') && pair.has('ecology')) {
    return `从${previous.display_name}转到${current.display_name}，能看到教育文化空间和开放生态空间之间的衔接。`
  }
  if (pair.has('commercial') && pair.has('ecology')) {
    return `讲完${previous.display_name}再看${current.display_name}，可以比较消费活力和公共生态空间的过渡。`
  }
  if (pair.has('education') && pair.has('commercial')) {
    return `从${previous.display_name}转向${current.display_name}，能看到科教文化片区和周边生活消费配套的联系。`
  }
  return `从${previous.display_name}转向${current.display_name}，可以看到不同城市功能在当前视野里的互补关系。`
}

function semanticLabel(kind: RegionSemanticKind): string {
  const labels: Record<RegionSemanticKind, string> = {
    education: '教育文化',
    ecology: '生态休闲',
    commercial: '商业消费',
    heritage: '历史文旅',
    transport: '交通入口',
    civic: '公共服务',
    mixed: '混合城市',
  }
  return labels[kind]
}

function formatDistanceKm(previous: RegionCandidate, current: RegionCandidate): string {
  return distanceKm(previous, current).toFixed(1)
}

function distanceKm(previous: RegionCandidate, current: RegionCandidate): number {
  const [leftLon, leftLat] = centerFromBoundary(previous.boundary)
  const [rightLon, rightLat] = centerFromBoundary(current.boundary)
  const midLat = ((leftLat + rightLat) / 2) * Math.PI / 180
  const dx = (leftLon - rightLon) * 111.32 * Math.cos(midLat)
  const dy = (leftLat - rightLat) * 110.54
  return Math.sqrt(dx * dx + dy * dy)
}
