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
  NarrativeBoundaryGeometry,
  NarrativeChapter,
  NarrativeFact,
  NarrativePathNode,
  NarrativePoi,
  NarrativeRegion,
  NarrativeRegionGlowLayer,
  NarrativeResponse,
  NarrativeUiSettings,
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
): NarrativeBoundaryGeometry {
  return {
    type: 'Polygon',
    coordinates: [
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

function makeGlowLayer(
  cx: number,
  cy: number,
  baseRxDeg: number,
  baseRyDeg: number,
  color: string
): NarrativeRegionGlowLayer {
  return {
    core: { type: 'Polygon', coordinates: [makeEllipseRing(cx, cy, baseRxDeg * 0.55, baseRyDeg * 0.55)] },
    inner: { type: 'Polygon', coordinates: [makeEllipseRing(cx, cy, baseRxDeg, baseRyDeg)] },
    outer: { type: 'Polygon', coordinates: [makeEllipseRing(cx, cy, baseRxDeg * 1.6, baseRyDeg * 1.6)] },
    color,
    opacity_profile: { core: 0.42, inner: 0.22, outer: 0.10 }
  }
}

function makeVisualLayer(cx: number, cy: number, baseRxDeg: number, baseRyDeg: number, color: string) {
  return {
    mode: 'region_glow' as const,
    region_glow: makeGlowLayer(cx, cy, baseRxDeg, baseRyDeg, color)
  }
}

function fact(regionId: string, claim: string, source: NarrativeFact['source'] = 'postgis'): NarrativeFact {
  return {
    claim,
    source,
    confidence: source === 'web_verified' ? 0.8 : 0.95,
    verified: source === 'web_verified',
    related_entity: { type: 'region', id: regionId }
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
// 三个主区域（基于 §4 区域候选规范）
// ============================================================================

// 武昌中北部 viewport，center [114.33, 30.575]，覆盖湖大 / 沙湖 / 武昌江滩
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
const HBU_COLOR = '#ef4444'
const REGION_HBU: NarrativeRegion = {
  id: 'r-hubei-univ',
  display_name: '湖北大学',
  role: 'primary_region',
  core_anchor: { id: 'a-hbu', lon: HBU_CX, lat: HBU_CY },
  boundary: makeRectBoundary(HBU_CX, HBU_CY, 0.012, 0.009),
  visual_layer: makeVisualLayer(HBU_CX, HBU_CY, 0.011, 0.008, HBU_COLOR),
  narrative_facts: [
    fact('r-hubei-univ', '湖北大学位于武昌区友谊大道，紧邻沙湖。'),
    fact('r-hubei-univ', '校园内拥有图书馆、体育场、博物馆等多组功能性建筑。'),
    fact('r-hubei-univ', '校园南门方向可步行至沙湖公园，是校园与城市公共空间的连接点。'),
    fact('r-hubei-univ', '学生人流密集，午间和傍晚活力最高。')
  ],
  pois: [
    { id: 'p-hbu-1', lon: HBU_CX, lat: HBU_CY, display_name: '湖北大学', tier: 'core', role: 'primary_region', category_main: '科教文化' },
    { id: 'p-hbu-2', lon: HBU_CX - 0.004, lat: HBU_CY - 0.002, display_name: '湖北大学图书馆', tier: 'strong', role: 'support_region', category_main: '科教文化' },
    { id: 'p-hbu-3', lon: HBU_CX + 0.004, lat: HBU_CY + 0.002, display_name: '湖北大学体育馆', tier: 'strong', role: 'support_region', category_main: '体育休闲' },
    { id: 'p-hbu-4', lon: HBU_CX - 0.002, lat: HBU_CY + 0.003, display_name: '湖北大学博物馆', tier: 'strong', role: 'scene_evidence', category_main: '科教文化' },
    { id: 'p-hbu-5', lon: HBU_CX + 0.002, lat: HBU_CY - 0.003, display_name: '湖北大学教学楼', tier: 'medium', role: 'scene_evidence', category_main: '科教文化' },
    { id: 'p-hbu-6', lon: HBU_CX - 0.005, lat: HBU_CY + 0.001, display_name: '湖北大学学生宿舍', tier: 'medium', role: 'scene_evidence', category_main: '科教文化' },
    { id: 'p-hbu-7', lon: HBU_CX + 0.003, lat: HBU_CY - 0.001, display_name: '湖北大学学生食堂', tier: 'medium', role: 'scene_evidence', category_main: '餐饮美食' },
    { id: 'p-hbu-8', lon: HBU_CX - 0.006, lat: HBU_CY - 0.004, display_name: '湖北大学南门出入口', tier: 'weak', role: 'background_ecology', category_main: '通行设施' },
    { id: 'p-hbu-9', lon: HBU_CX + 0.006, lat: HBU_CY + 0.001, display_name: '湖北大学停车场', tier: 'weak', role: 'background_ecology', category_main: '停车场' }
  ]
}

// 2. 沙湖公园（support_region）
const SHA_CX = 114.342
const SHA_CY = 30.585
const SHA_COLOR = '#14b8a6'
const REGION_SHAHU: NarrativeRegion = {
  id: 'r-shahu-park',
  display_name: '沙湖公园',
  role: 'support_region',
  core_anchor: { id: 'a-sha', lon: SHA_CX, lat: SHA_CY },
  boundary: makeRectBoundary(SHA_CX, SHA_CY, 0.010, 0.007),
  visual_layer: makeVisualLayer(SHA_CX, SHA_CY, 0.009, 0.006, SHA_COLOR),
  narrative_facts: [
    fact('r-shahu-park', '沙湖公园是武昌北部重要的城市绿肺，水域面积广阔。'),
    fact('r-shahu-park', '环湖步道贯穿全园，是市民日常休闲的首选去处。'),
    fact('r-shahu-park', '与湖北大学仅一街之隔，构成校园-自然连接带。')
  ],
  pois: [
    { id: 'p-sha-1', lon: SHA_CX, lat: SHA_CY, display_name: '沙湖公园', tier: 'core', role: 'support_region', category_main: '风景名胜' },
    { id: 'p-sha-2', lon: SHA_CX - 0.005, lat: SHA_CY + 0.001, display_name: '沙湖公园环湖步道', tier: 'strong', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-sha-3', lon: SHA_CX + 0.004, lat: SHA_CY + 0.002, display_name: '沙湖湿地展示区', tier: 'strong', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-sha-4', lon: SHA_CX + 0.006, lat: SHA_CY - 0.002, display_name: '沙湖公园观景平台', tier: 'medium', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-sha-5', lon: SHA_CX - 0.004, lat: SHA_CY - 0.003, display_name: '沙湖公园游客中心', tier: 'medium', role: 'scene_evidence', category_main: '生活服务' },
    { id: 'p-sha-6', lon: SHA_CX + 0.008, lat: SHA_CY + 0.004, display_name: '沙湖公园停车场', tier: 'weak', role: 'background_ecology', category_main: '停车场' }
  ]
}

// 3. 昙江滩（landmark_anchor）
const JIANGTAN_CX = 114.318
const JIANGTAN_CY = 30.592
const JIANGTAN_COLOR = '#0ea5e9'
const REGION_JIANGTAN: NarrativeRegion = {
  id: 'r-wuchang-jiangtan',
  display_name: '武昌江滩',
  role: 'landmark_anchor',
  core_anchor: { id: 'a-jiangtan', lon: JIANGTAN_CX, lat: JIANGTAN_CY },
  boundary: makeRectBoundary(JIANGTAN_CX, JIANGTAN_CY, 0.006, 0.018),
  visual_layer: makeVisualLayer(JIANGTAN_CX, JIANGTAN_CY, 0.007, 0.016, JIANGTAN_COLOR),
  narrative_facts: [
    fact('r-wuchang-jiangtan', '武昌江滩沿长江展开，是武昌北部重要的滨水公共空间。'),
    fact('r-wuchang-jiangtan', '江滩步道、观景平台和桥下空间共同构成亲水游览带。'),
    fact('r-wuchang-jiangtan', '从沙湖向西可过渡到江滩，形成校园、湖泊与长江岸线的连续叙事。')
  ],
  pois: [
    { id: 'p-jiang-1', lon: JIANGTAN_CX, lat: JIANGTAN_CY, display_name: '武昌江滩', tier: 'core', role: 'landmark_anchor', category_main: '风景名胜' },
    { id: 'p-jiang-2', lon: JIANGTAN_CX - 0.002, lat: JIANGTAN_CY + 0.006, display_name: '武昌江滩步道', tier: 'strong', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-jiang-3', lon: JIANGTAN_CX + 0.001, lat: JIANGTAN_CY - 0.006, display_name: '徐家棚江滩', tier: 'strong', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-jiang-4', lon: JIANGTAN_CX - 0.003, lat: JIANGTAN_CY + 0.011, display_name: '江滩观景平台', tier: 'medium', role: 'scene_evidence', category_main: '风景名胜' },
    { id: 'p-jiang-5', lon: JIANGTAN_CX + 0.002, lat: JIANGTAN_CY - 0.010, display_name: '长江二桥桥下空间', tier: 'medium', role: 'scene_evidence', category_main: '城市公共空间' },
    { id: 'p-jiang-6', lon: JIANGTAN_CX + 0.004, lat: JIANGTAN_CY + 0.004, display_name: '江滩停车场', tier: 'weak', role: 'background_ecology', category_main: '停车场' }
  ]
}

// 4. 程序化生成背景点云，铺满整个视图（§2 渲染分层 weak/medium）
const BACKGROUND_POIS: NarrativePoi[] = generateBackgroundPois(
  [
    // 沿 3 个核心 anchor 散布 strong 层
    { cx: HBU_CX, cy: HBU_CY, rxDeg: 0.012, ryDeg: 0.009, count: 70, tier: 'strong', role: 'scene_evidence', prefix: '湖大校内' },
    { cx: SHA_CX, cy: SHA_CY, rxDeg: 0.015, ryDeg: 0.011, count: 60, tier: 'strong', role: 'scene_evidence', prefix: '沙湖园内' },
    { cx: JIANGTAN_CX, cy: JIANGTAN_CY, rxDeg: 0.007, ryDeg: 0.018, count: 55, tier: 'strong', role: 'scene_evidence', prefix: '江滩步道' },
    // medium 层（一般相关）
    { cx: HBU_CX, cy: HBU_CY, rxDeg: 0.018, ryDeg: 0.014, count: 75, tier: 'medium', role: 'background_ecology', prefix: '湖大生活' },
    { cx: SHA_CX, cy: SHA_CY, rxDeg: 0.022, ryDeg: 0.017, count: 70, tier: 'medium', role: 'background_ecology', prefix: '沙湖周边' },
    { cx: JIANGTAN_CX, cy: JIANGTAN_CY, rxDeg: 0.011, ryDeg: 0.024, count: 65, tier: 'medium', role: 'background_ecology', prefix: '滨江生活' },
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
  REGION_JIANGTAN
]

const PATH_NODES: NarrativePathNode[] = [
  { region_id: REGION_HBU.id, narration_role: 'core', transition_reason: '当前视角主体，先讲清楚核心区域' },
  { region_id: REGION_SHAHU.id, narration_role: 'ecological', transition_reason: '从校园延伸到自然休闲空间' },
  { region_id: REGION_JIANGTAN.id, narration_role: 'landmark', transition_reason: '沿沙湖向西，把叙事带到长江岸线' }
]

const NARRATION_CHAPTERS: NarrativeChapter[] = [
  {
    region_id: REGION_HBU.id,
    text: '当前视角的主角是湖北大学。这里不只看一个校名点，而是利用校园 AOI 范围把图书馆、体育馆、博物馆、教学楼、宿舍和食堂分层组织起来，形成一个校内热力簇。',
    length_ms: 12000
  },
  {
    region_id: REGION_SHAHU.id,
    text: '紧邻校园的沙湖公园，是这片区域的自然侧。环湖步道与林荫小径让校园生活与城市绿地无缝相连。',
    length_ms: 9000
  },
  {
    region_id: REGION_JIANGTAN.id,
    text: '再往西，叙事落到武昌江滩。江滩不是一个单点，而是沿长江展开的线性公共空间，步道、观景平台和桥下空间共同构成滨水热力带。',
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
  session_id: 'mock-narrative-session-20260429',
  state_version: 1,
  scene_profile: 'education_culture',
  lod: 'micro',
  viewport: VIEWPORT,
  dominant_coverage: 0.62,
  candidate_count: 3,
  poi_density: 0.78,
  semantic_diversity: 0.55,
  regions: REGIONS,
  path: {
    nodes: PATH_NODES,
    seed: 'mock-seed-20260429',
    alternatives_count: 1
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
