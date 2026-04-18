/**
 * 视口裁剪工具：把 narrative 节点的模糊边界裁剪到当前视口矩形内。
 *
 * 这是 narrative 系统对用户的基本承诺：
 *   > "既然最后拿到了某个节点，那它必须在视口内能呈现出一个具体的几何图形"
 *
 * 因此所有 boundary（无论来自 AOI 原生 / landuse_parcel / aggregate_morphology /
 * point_halo）生成后，都必须过一次本模块的裁剪。裁剪后：
 *   - 完全不相交视口 → 返回 null，调用方应当淘汰该节点
 *   - 部分相交         → 返回裁剪后的 Polygon/MultiPolygon，以及裁剪后面积
 *
 * 坐标系假定：
 *   - 入参 boundary 的 coordinates 已经是 GCJ02（与高德底图对齐）
 *   - 入参 viewport 是 WGS84（后端统一的视口坐标系）
 *   - 本模块会把 viewport 四角做 WGS84 → GCJ02，然后取 bbox 包络矩形，
 *     在 GCJ02 空间里做 Sutherland–Hodgman 轴对齐矩形裁剪
 *
 * 实现限制：
 *   - 只处理外环裁剪，忽略内环（孔洞），对 narrative 模糊展示已经够用
 *   - 裁剪完不严格重建 MultiPolygon 组分，只是把每个 polygon 独立裁剪后过滤
 */

import type { NarrativeNodeBoundary, NarrativeViewport } from './types.js'
import { wgs84ToGcj02 } from './gcj02.js'

type Point = [number, number]
type Ring = Point[]
type Bbox = { minLon: number, minLat: number, maxLon: number, maxLat: number }
type ClipEdge = 'left' | 'right' | 'bottom' | 'top'

const CLIP_EDGES: readonly ClipEdge[] = ['left', 'right', 'bottom', 'top'] as const

/**
 * 把 WGS84 viewport 四个角转成 GCJ02，再取 bbox 包络矩形。
 *
 * GCJ02 在中国区域只有几百米的非线性偏移，viewport 四角转换后并非严格矩形，
 * 但取 bbox 包络会让裁剪略偏宽（对外扩约 0-500m）。
 * 对 "boundary 是否在视口内" 这个粗粒度判定足够稳妥——宁可多留一点边缘，
 * 也不要把视口正中心的主体切碎。
 */
function viewportBboxInGcj02(viewport: NarrativeViewport): Bbox {
  const corners: Point[] = [
    wgs84ToGcj02(viewport.swLon, viewport.swLat),
    wgs84ToGcj02(viewport.neLon, viewport.swLat),
    wgs84ToGcj02(viewport.neLon, viewport.neLat),
    wgs84ToGcj02(viewport.swLon, viewport.neLat),
  ]
  let minLon = Infinity, minLat = Infinity
  let maxLon = -Infinity, maxLat = -Infinity
  for (const [lon, lat] of corners) {
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

function insideEdge(pt: Point, edge: ClipEdge, bbox: Bbox): boolean {
  switch (edge) {
    case 'left':   return pt[0] >= bbox.minLon
    case 'right':  return pt[0] <= bbox.maxLon
    case 'bottom': return pt[1] >= bbox.minLat
    case 'top':    return pt[1] <= bbox.maxLat
  }
}

/** 线段 a→b 与矩形边 edge 的交点（线性插值）。 */
function intersectEdge(a: Point, b: Point, edge: ClipEdge, bbox: Bbox): Point {
  const [ax, ay] = a
  const [bx, by] = b
  switch (edge) {
    case 'left': {
      const t = (bbox.minLon - ax) / (bx - ax || 1e-12)
      return [bbox.minLon, ay + t * (by - ay)]
    }
    case 'right': {
      const t = (bbox.maxLon - ax) / (bx - ax || 1e-12)
      return [bbox.maxLon, ay + t * (by - ay)]
    }
    case 'bottom': {
      const t = (bbox.minLat - ay) / (by - ay || 1e-12)
      return [ax + t * (bx - ax), bbox.minLat]
    }
    case 'top': {
      const t = (bbox.maxLat - ay) / (by - ay || 1e-12)
      return [ax + t * (bx - ax), bbox.maxLat]
    }
  }
}

/** 单条 ring 做 Sutherland–Hodgman 裁剪，返回闭合 ring（<4 点则返回空）。 */
function clipRing(ring: Ring, bbox: Bbox): Ring {
  if (ring.length < 4) return []
  // 工作 ring 去掉闭合重复点（最后一个点 == 第一个点）以便循环处理
  const working = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice()
  let output: Ring = working
  for (const edge of CLIP_EDGES) {
    if (output.length === 0) break
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const current = input[i]
      const prev = input[(i - 1 + input.length) % input.length]
      const curIn = insideEdge(current, edge, bbox)
      const prevIn = insideEdge(prev, edge, bbox)
      if (curIn) {
        if (!prevIn) output.push(intersectEdge(prev, current, edge, bbox))
        output.push(current)
      } else if (prevIn) {
        output.push(intersectEdge(prev, current, edge, bbox))
      }
    }
  }
  if (output.length < 3) return []
  // 闭合 ring
  const first = output[0]
  const last = output[output.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    output.push([first[0], first[1]])
  }
  return output.length >= 4 ? output : []
}

/** 用经纬度 shoelace 面积 × 经纬米换算，粗估 ring 的平方米面积。只用于相对判断。 */
function approxRingAreaM2(ring: Ring): number {
  if (ring.length < 4) return 0
  let signed = 0
  let latSum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    signed += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    latSum += ring[i][1]
  }
  const avgLat = latSum / (ring.length - 1)
  const metersPerDegLat = 111320
  const metersPerDegLon = metersPerDegLat * Math.cos(avgLat * Math.PI / 180)
  return Math.abs(signed) / 2 * metersPerDegLat * metersPerDegLon
}

/**
 * 把 boundary 裁剪到视口矩形内。
 *
 * @returns
 *   - `boundary`：裁剪后的 Polygon/MultiPolygon；与视口完全不相交时为 null
 *   - `clippedAreaM2`：裁剪后所有外环面积之和（m²）。小于阈值时调用方可进一步淘汰节点
 */
export function clipBoundaryToViewport(
  boundary: NarrativeNodeBoundary,
  viewport: NarrativeViewport,
): { boundary: NarrativeNodeBoundary | null, clippedAreaM2: number } {
  const bbox = viewportBboxInGcj02(viewport)

  if (boundary.type === 'Polygon') {
    const rings = boundary.coordinates as unknown as Ring[]
    if (!Array.isArray(rings) || rings.length === 0) return { boundary: null, clippedAreaM2: 0 }
    const clipped = rings
      .map((r) => clipRing(normalizeRing(r), bbox))
      .filter((r) => r.length >= 4)
    if (clipped.length === 0) return { boundary: null, clippedAreaM2: 0 }
    // 外环面积作为代表面积
    const area = approxRingAreaM2(clipped[0])
    return {
      boundary: {
        ...boundary,
        coordinates: clipped as unknown as number[][][],
      },
      clippedAreaM2: area,
    }
  }

  if (boundary.type === 'MultiPolygon') {
    const polys = boundary.coordinates as unknown as Ring[][]
    if (!Array.isArray(polys) || polys.length === 0) return { boundary: null, clippedAreaM2: 0 }
    const clippedPolys: Ring[][] = []
    let totalArea = 0
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue
      const clipped = poly
        .map((r) => clipRing(normalizeRing(r), bbox))
        .filter((r) => r.length >= 4)
      if (clipped.length > 0) {
        clippedPolys.push(clipped)
        totalArea += approxRingAreaM2(clipped[0])
      }
    }
    if (clippedPolys.length === 0) return { boundary: null, clippedAreaM2: 0 }
    return {
      boundary: {
        ...boundary,
        coordinates: clippedPolys as unknown as number[][][][],
      },
      clippedAreaM2: totalArea,
    }
  }

  return { boundary: null, clippedAreaM2: 0 }
}

/** 把 ring 里的 [lon, lat, ...] 数组统一成 Point 数组。 */
function normalizeRing(raw: unknown): Ring {
  if (!Array.isArray(raw)) return []
  return raw
    .map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) return null
      const lon = Number(pt[0])
      const lat = Number(pt[1])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
      return [lon, lat] as Point
    })
    .filter((p): p is Point => p !== null)
}

/** 判断 2D 点是否在视口矩形内（与 boundary 同用一套 GCJ02 bbox 逻辑）。 */
export function isPointInViewport(
  point: { lon: number, lat: number },
  viewport: NarrativeViewport,
): boolean {
  const bbox = viewportBboxInGcj02(viewport)
  return point.lon >= bbox.minLon
    && point.lon <= bbox.maxLon
    && point.lat >= bbox.minLat
    && point.lat <= bbox.maxLat
}
