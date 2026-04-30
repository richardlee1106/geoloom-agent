/**
 * Narrative Mock 数据
 *
 * 用途：阶段 2 Mock UI 阶段驱动整个 narrative 页面
 * 边界：完全不依赖后端，所有字段严格遵守 src/views/narrative/types.ts
 *
 * 注意：阶段 3 算法替换时，应以**相同的字段结构**返回真实数据，
 * 否则视为破坏数据契约，必须先更新 §8 规范。
 */

import type {
  GlowLayers,
  NarrativeChapter,
  NarrativePathNode,
  NarrativePoi,
  NarrativeRegion,
  NarrativeResponse,
  NarrativeUiSettings,
  PolygonRing,
  TierStats,
  UserContext,
  VisualTier
} from '../types'

// ============================================================================
// 工具：构造矩形边界 / 同心多层光晕 / 背景点云
// ============================================================================

function makeRectBoundary(
  cx: number,
  cy: number,
  halfLon: number,
  halfLat: number
): PolygonRing {
  return {
    rings: [
      [
        [cx - halfLon, cy - halfLat],
        [cx + halfLon, cy - halfLat],
        [cx + halfLon, cy + halfLat],
        [cx - halfLon, cy + halfLat],
        [cx - halfLon, cy - halfLat]
      ]
    ]
  }
}

function makeEllipseRing(
  cx: number,
  cy: number,
  rxDeg: number,
  ryDeg: number,
  steps = 32
): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    ring.push([cx + Math.cos(t) * rxDeg, cy + Math.sin(t) * ryDeg])
  }
  return ring
}

function makeGlowLayers(cx: number, cy: number, baseRxDeg: number, baseRyDeg: number): GlowLayers {
  return {
    core: { rings: [makeEllipseRing(cx, cy, baseRxDeg * 0.55, baseRyDeg * 0.55)] },
    inner: { rings: [makeEllipseRing(cx, cy, baseRxDeg, baseRyDeg)] },
    outer: { rings: [makeEllipseRing(cx, cy, baseRxDeg * 1.6, baseRyDeg * 1.6)] }
  }
}

// 简单可重复随机数（避免每次刷新点位漂移）
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOISE_CATEGORIES = ['餐饮美食', '购物服务', '生活服务', '体育休闲', '医疗保健']

interface PoiSeed {
  cx: number
  cy: number
  rxDeg: number
  ryDeg: number
  count: number
  tier: VisualTier
  role: NarrativePoi['role']
  prefix: string
}

function generateBackgroundPois(seeds: PoiSeed[], rngSeed: number): NarrativePoi[] {
  const rng = mulberry32(rngSeed)
  const pois: NarrativePoi[] = []
  let idx = 0
  for (const s of seeds) {
    for (let i = 0; i < s.count; i++) {
      // 高斯偏移：靠近 anchor 多，远离 anchor 少
      const u1 = Math.max(rng(), 1e-6)
      const u2 = rng()
      const r = Math.sqrt(-2 * Math.log(u1)) * 0.4 // 缩小半径系数
      const theta = u2 * Math.PI * 2
      const lon = s.cx + Math.cos(theta) * r * s.rxDeg
      const lat = s.cy + Math.sin(theta) * r * s.ryDeg
      pois.push({
        id: `bg-${s.tier}-${idx++}`,
        lon,
        lat,
        display_name: `${s.prefix}-${i + 1}`,
        tier: s.tier,
        role: s.role,
        category_main: NOISE_CATEGORIES[Math.floor(rng() * NOISE_CATEGORIES.length)]
      })
    }
  }
  return pois
}

// ============================================================================
// 五个主区域（基于 §4 区域候选规范）
// ============================================================================

// 武昌中部 viewport，center [114.33, 30.575]，覆盖湖大 / 沙湖 / 昙华林 / 黄鹤楼 / 武大
const VIEWPORT = {
  west: 114.26,
  south: 30.525,
  east: 114.40,
  north: 30.625,
  zoom: 14,
  center: [114.33, 30.575] as [number, number]
}

// 1. 湖北大学（primary_region，主体）
const HBU_CX = 114.353
const HBU_CY = 30.602
const REGION_HBU: NarrativeRegion = {
  id: 'r-hubei-univ',
  display_name: '湖北大学',
  role: 'primary_region',
  core_anchor: { id: 'a-hbu', lon: HBU_CX, lat: HBU_CY },
  boundary: makeRectBoundary(HBU_CX, HBU_CY, 0.012, 0.009),
  glow_layers: makeGlowLayers(HBU_CX, HBU_CY, 0.011, 0.008),
  chapter_label: '核心',
  narrative_facts: [
    '湖北大学位于武昌区友谊大道，紧邻沙湖。',
    '校园内拥有图书馆、体育场、博物馆等多组功能性建筑。',
    '校园南门方向可步行至沙湖公园，是校园与城市公共空间的连接点。',
    '学生人流密集，午间和傍晚活力最高。'
  ],
  pois: [
    { id: 'p-hbu-1', lon: HBU_CX, lat: HBU_CY, display_name: '湖北大学', tier: 'core', role: 'primary_region', category_main: '科教文化' },
    { id: 'p-hbu-2', lon: HBU_CX - 0.004, lat: HBU_CY - 0.002, display_name: '湖大图书馆', tier: 'strong', role: 'support_region', category_main: '科教文化' },
    { id: 'p-hbu-3', lon: HBU_CX + 0.005, lat: HBU_CY + 0.002, display_name: '湖大体育馆', tier: 'strong', role: 'support_region', category_main: '科教文化' },
    { id: 'p-hbu-4', lon: HBU_CX - 0.003, lat: HBU_CY + 0.004, display_name: '湖大南门', tier: 'medium', role: 'landmark_anchor', category_main: '科教文化' }
  ]
}

// 2. 沙湖公园（support_region）
const SHA_CX = 114.342
const SHA_CY = 30.585
const REGION_SHAHU: NarrativeRegion = {
  id: 'r-shahu-park',
  display_name: '沙湖公园',
  role: 'support_region',
  core_anchor: { id: 'a-sha', lon: SHA_CX, lat: SHA_CY },
  boundary: makeRectBoundary(SHA_CX, SHA_CY, 0.010, 0.007),
  glow_layers: makeGlowLayers(SHA_CX, SHA_CY, 0.009, 0.006),
  chapter_label: '关联',
  narrative_facts: [
    '沙湖公园是武昌北部重要的城市绿肺，水域面积广阔。',
    '环湖步道贯穿全园，是市民日常休闲的首选去处。',
    '与湖北大学仅一街之隔，构成校园-自然连接带。'
  ],
  pois: [
    { id: 'p-sha-1', lon: SHA_CX, lat: SHA_CY, display_name: '沙湖公园', tier: 'core', role: 'support_region', category_main: '风景名胜' },
    { id: 'p-sha-2', lon: SHA_CX + 0.006, lat: SHA_CY + 0.010, display_name: '沙湖众创城', tier: 'strong', role: 'support_region', category_main: '商务大厦' },
    { id: 'p-sha-3', lon: SHA_CX - 0.005, lat: SHA_CY + 0.001, display_name: '沙湖步道', tier: 'medium', role: 'scene_evidence', category_main: '风景名胜' }
  ]
}

// 3. 昙华林（landmark_anchor）
const TAN_CX = 114.300
const TAN_CY = 30.555
const REGION_TAN: NarrativeRegion = {
  id: 'r-tanhualin',
  display_name: '昙华林',
  role: 'landmark_anchor',
  core_anchor: { id: 'a-tan', lon: TAN_CX, lat: TAN_CY },
  boundary: makeRectBoundary(TAN_CX, TAN_CY, 0.008, 0.005),
  glow_layers: makeGlowLayers(TAN_CX, TAN_CY, 0.007, 0.005),
  chapter_label: '文化',
  narrative_facts: [
    '昙华林是武昌老街区，保留大量近代建筑与历史里巷。',
    '街区里集合咖啡馆、书店与文创小店，兼具历史与现代生活气息。',
    '是城市文化更新的代表性街区。'
  ],
  pois: [
    { id: 'p-tan-1', lon: TAN_CX, lat: TAN_CY, display_name: '昙华林', tier: 'core', role: 'landmark_anchor', category_main: '风景名胜' },
    { id: 'p-tan-2', lon: TAN_CX - 0.004, lat: TAN_CY + 0.002, display_name: '户部巷', tier: 'strong', role: 'landmark_anchor', category_main: '风景名胜' },
    { id: 'p-tan-3', lon: TAN_CX + 0.003, lat: TAN_CY - 0.001, display_name: '昙华林文创', tier: 'medium', role: 'scene_evidence', category_main: '购物服务' }
  ]
}

// 4. 黄鹤楼（landmark_anchor）
const HHL_CX = 114.305
const HHL_CY = 30.547
const REGION_HHL: NarrativeRegion = {
  id: 'r-huanghelou',
  display_name: '黄鹤楼',
  role: 'landmark_anchor',
  core_anchor: { id: 'a-hhl', lon: HHL_CX, lat: HHL_CY },
  boundary: makeRectBoundary(HHL_CX, HHL_CY, 0.007, 0.005),
  glow_layers: makeGlowLayers(HHL_CX, HHL_CY, 0.006, 0.004),
  chapter_label: '地标',
  narrative_facts: [
    '黄鹤楼始建于三国，是武汉最具代表性的城市地标。',
    '楼台俯瞰长江，是武昌临江观景的核心点。',
    '与首义广场相邻，构成历史文化集群。'
  ],
  pois: [
    { id: 'p-hhl-1', lon: HHL_CX, lat: HHL_CY, display_name: '黄鹤楼', tier: 'core', role: 'landmark_anchor', category_main: '风景名胜' },
    { id: 'p-hhl-2', lon: HHL_CX - 0.003, lat: HHL_CY - 0.008, display_name: '首义广场', tier: 'strong', role: 'landmark_anchor', category_main: '风景名胜' }
  ]
}

// 5. 武汉大学（primary_region）
const WHU_CX = 114.367
const WHU_CY = 30.541
const REGION_WHU: NarrativeRegion = {
  id: 'r-wuhan-univ',
  display_name: '武汉大学',
  role: 'primary_region',
  core_anchor: { id: 'a-whu', lon: WHU_CX, lat: WHU_CY },
  boundary: makeRectBoundary(WHU_CX, WHU_CY, 0.013, 0.010),
  glow_layers: makeGlowLayers(WHU_CX, WHU_CY, 0.012, 0.009),
  chapter_label: '教育',
  narrative_facts: [
    '武汉大学坐拥珞珈山，是武汉最具代表性的综合大学。',
    '校园地形起伏，老建筑群保留完整。',
    '春季樱花闻名，是武汉重要的城市文化记忆点。'
  ],
  pois: [
    { id: 'p-whu-1', lon: WHU_CX, lat: WHU_CY, display_name: '武汉大学', tier: 'core', role: 'primary_region', category_main: '科教文化' },
    { id: 'p-whu-2', lon: WHU_CX - 0.005, lat: WHU_CY + 0.003, display_name: '珞珈山', tier: 'strong', role: 'support_region', category_main: '风景名胜' },
    { id: 'p-whu-3', lon: WHU_CX + 0.004, lat: WHU_CY - 0.002, display_name: '武大樱园', tier: 'strong', role: 'scene_evidence', category_main: '风景名胜' }
  ]
}

// 6. 程序化生成背景点云，铺满整个视图（§2 渲染分层 weak/medium）
const BACKGROUND_POIS: NarrativePoi[] = generateBackgroundPois(
  [
    // 沿 5 个核心 anchor 散布 strong 层
    { cx: HBU_CX, cy: HBU_CY, rxDeg: 0.018, ryDeg: 0.014, count: 60, tier: 'strong', role: 'scene_evidence', prefix: '湖大邻里' },
    { cx: SHA_CX, cy: SHA_CY, rxDeg: 0.014, ryDeg: 0.010, count: 50, tier: 'strong', role: 'scene_evidence', prefix: '沙湖周边' },
    { cx: TAN_CX, cy: TAN_CY, rxDeg: 0.012, ryDeg: 0.008, count: 45, tier: 'strong', role: 'scene_evidence', prefix: '昙华林街' },
    { cx: HHL_CX, cy: HHL_CY, rxDeg: 0.010, ryDeg: 0.008, count: 40, tier: 'strong', role: 'scene_evidence', prefix: '黄鹤楼下' },
    { cx: WHU_CX, cy: WHU_CY, rxDeg: 0.018, ryDeg: 0.014, count: 55, tier: 'strong', role: 'scene_evidence', prefix: '武大邻里' },
    // medium 层（一般相关）
    { cx: HBU_CX, cy: HBU_CY, rxDeg: 0.030, ryDeg: 0.022, count: 90, tier: 'medium', role: 'background_ecology', prefix: '邻区生活' },
    { cx: SHA_CX, cy: SHA_CY, rxDeg: 0.026, ryDeg: 0.020, count: 80, tier: 'medium', role: 'background_ecology', prefix: '沙湖生活' },
    { cx: TAN_CX, cy: TAN_CY, rxDeg: 0.024, ryDeg: 0.018, count: 70, tier: 'medium', role: 'background_ecology', prefix: '昙华生活' },
    { cx: HHL_CX, cy: HHL_CY, rxDeg: 0.022, ryDeg: 0.016, count: 65, tier: 'medium', role: 'background_ecology', prefix: '黄鹤生活' },
    { cx: WHU_CX, cy: WHU_CY, rxDeg: 0.030, ryDeg: 0.022, count: 85, tier: 'medium', role: 'background_ecology', prefix: '武大生活' },
    // weak 层（边缘）
    { cx: 114.33, cy: 30.575, rxDeg: 0.060, ryDeg: 0.046, count: 320, tier: 'weak', role: 'background_ecology', prefix: '边缘点' },
    // excluded 层（剔除边缘）— 仅记录，不渲染主层
    { cx: 114.33, cy: 30.575, rxDeg: 0.080, ryDeg: 0.060, count: 60, tier: 'excluded', role: 'noise', prefix: '剔除点' }
  ],
  20260429
)

// ============================================================================
// 主响应（§8.1 顶层结构）
// ============================================================================

const REGIONS: NarrativeRegion[] = [
  REGION_HBU,
  REGION_SHAHU,
  REGION_TAN,
  REGION_HHL,
  REGION_WHU
]

const PATH_NODES: NarrativePathNode[] = [
  { region_id: REGION_HBU.id, narration_role: 'core', transition_reason: '当前视角主体，先讲清楚核心区域' },
  { region_id: REGION_SHAHU.id, narration_role: 'ecological', transition_reason: '从校园延伸到自然休闲空间' },
  { region_id: REGION_TAN.id, narration_role: 'cultural', transition_reason: '由自然过渡到老街区文化' },
  { region_id: REGION_HHL.id, narration_role: 'landmark', transition_reason: '从街巷文化跳转到城市地标' },
  { region_id: REGION_WHU.id, narration_role: 'educational', transition_reason: '收束到与湖大呼应的另一所代表大学' }
]

const NARRATION_CHAPTERS: NarrativeChapter[] = [
  {
    region_id: REGION_HBU.id,
    text: '当前视角的主角是湖北大学，校园紧靠沙湖，构成了武昌北部典型的校园生活核心。围绕主校区延展开，可以看到图书馆、体育馆和南门一带的活力区。',
    length_ms: 12000
  },
  {
    region_id: REGION_SHAHU.id,
    text: '紧邻校园的沙湖公园，是这片区域的自然侧。环湖步道与林荫小径让校园生活与城市绿地无缝相连。',
    length_ms: 9000
  },
  {
    region_id: REGION_TAN.id,
    text: '继续向西，进入昙华林老街区。这里保留了大量近代建筑，咖啡馆与文创小店穿插其间，是城市更新的样本。',
    web_source: { title: '昙华林：武昌的老街新生', url: 'https://example.com/tanhualin' },
    length_ms: 11000
  },
  {
    region_id: REGION_HHL.id,
    text: '再向南就是黄鹤楼。它俯瞰长江，是武汉最具代表性的城市地标，也是这一带历史叙事的最高点。',
    length_ms: 10000
  },
  {
    region_id: REGION_WHU.id,
    text: '最后落到武汉大学。它与湖北大学呼应，珞珈山起伏的地形和老校园建筑群，让这条解说在两所大学之间形成闭环。',
    length_ms: 11000
  }
]

const USER_CONTEXT: UserContext = {
  time_label: '工作日 下午',
  weather_label: '晴 32℃',
  preference_label: '历史文化、教育',
  history_label: '近 3 次查看东湖风景区'
}

export const narrativeMock: NarrativeResponse = {
  scene_profile: 'education_culture',
  lod: 'micro',
  viewport: VIEWPORT,
  dominant_coverage: 0.62,
  candidate_count: 5,
  poi_density: 0.78,
  semantic_diversity: 0.55,
  regions: REGIONS,
  path: {
    nodes: PATH_NODES,
    seed: 'mock-seed-20260429',
    alternatives_count: 4
  },
  narration: {
    chapters: NARRATION_CHAPTERS,
    tone: 'science'
  },
  user_context: USER_CONTEXT
}

// ============================================================================
// UI 派生数据（前端本地计算，方便 mock 阶段直接渲染）
// ============================================================================

export const allRenderablePois: NarrativePoi[] = [
  ...REGIONS.flatMap((r) => r.pois),
  ...BACKGROUND_POIS
]

export function computeTierStats(pois: NarrativePoi[]): TierStats {
  const stats: TierStats = { core: 0, strong: 0, medium: 0, weak: 0, excluded: 0 }
  for (const p of pois) stats[p.tier] += 1
  return stats
}

export const tierStats: TierStats = computeTierStats(allRenderablePois)

export const defaultUiSettings: NarrativeUiSettings = {
  relevanceThreshold: 0.25,
  opacityScale: 0.35,
  durationPreset: 'standard',
  tonePreset: 'science',
  centroidStrategy: 'auto',
  autoNarrate: true
}

// 当前视角覆盖分析（顶部环形图数据）
export const coverageBreakdown = {
  core_ratio: 0.62,
  surrounding_ratio: 0.23,
  others_ratio: 0.15
}

// 解说时长选项（§3 路径长度由 LOD 控制，但用户可粗调）
export const durationPresetOptions = [
  { key: 'casual' as const, label: '随兴', hint: '约 1 分钟' },
  { key: 'standard' as const, label: '标准', hint: '约 3 分钟' },
  { key: 'detailed' as const, label: '详尽', hint: '约 5 分钟' }
]

export const tonePresetOptions = [
  { key: 'science' as const, label: '知识科普' },
  { key: 'tour' as const, label: '导览解说' },
  { key: 'humanity' as const, label: '人文叙事' }
]

export const centroidStrategyOptions = [
  { key: 'auto' as const, label: '自动' },
  { key: 'region_first' as const, label: '片区优先' },
  { key: 'poi_first' as const, label: 'POI 优先' }
]
