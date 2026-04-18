import { describe, expect, it } from 'vitest'

import { clipBoundaryToViewport, isPointInViewport } from '../../../src/narrative/viewportClipping.js'
import type { NarrativeNodeBoundary, NarrativeViewport } from '../../../src/narrative/types.js'

// 典型武汉视口，WGS84
const VIEWPORT: NarrativeViewport = {
  swLon: 114.30,
  swLat: 30.55,
  neLon: 114.40,
  neLat: 30.62,
}

function polygon(ring: number[][], source: NarrativeNodeBoundary['source'] = 'aoi_native'): NarrativeNodeBoundary {
  return { type: 'Polygon', coordinates: [ring], source }
}

describe('clipBoundaryToViewport', () => {
  it('完全在视口内的 polygon 裁剪后面积不变（几何保留）', () => {
    // 小矩形 [114.33, 30.57] ~ [114.35, 30.58]，约 ~ 2200m × 1100m ≈ 2.4km²
    const inside = polygon([
      [114.33, 30.57],
      [114.35, 30.57],
      [114.35, 30.58],
      [114.33, 30.58],
      [114.33, 30.57],
    ])
    const { boundary, clippedAreaM2 } = clipBoundaryToViewport(inside, VIEWPORT)
    expect(boundary).not.toBeNull()
    expect(boundary!.type).toBe('Polygon')
    // 面积量级约 2.4 km² ≈ 2_400_000 m²
    expect(clippedAreaM2).toBeGreaterThan(1_000_000)
    expect(clippedAreaM2).toBeLessThan(5_000_000)
  })

  it('完全在视口外的 polygon 返回 null，表示应淘汰节点', () => {
    // 位于视口西侧几公里外
    const outside = polygon([
      [113.90, 30.50],
      [113.92, 30.50],
      [113.92, 30.52],
      [113.90, 30.52],
      [113.90, 30.50],
    ])
    const { boundary, clippedAreaM2 } = clipBoundaryToViewport(outside, VIEWPORT)
    expect(boundary).toBeNull()
    expect(clippedAreaM2).toBe(0)
  })

  it('跨视口边界的 polygon 会被裁剪到视口矩形内部', () => {
    // 横跨视口东侧边界：ring 从视口内 (114.38, 30.58) 延伸到视口外 (114.50, 30.58)
    const crossing = polygon([
      [114.38, 30.57],
      [114.50, 30.57],
      [114.50, 30.59],
      [114.38, 30.59],
      [114.38, 30.57],
    ])
    const { boundary, clippedAreaM2 } = clipBoundaryToViewport(crossing, VIEWPORT)
    expect(boundary).not.toBeNull()
    expect(boundary!.type).toBe('Polygon')
    expect(clippedAreaM2).toBeGreaterThan(0)
    const ring = (boundary!.coordinates as number[][][])[0]
    // 所有裁剪后的经度都应该在视口 bbox 内（考虑 GCJ02 偏移给 +0.01 容差）
    const maxLon = Math.max(...ring.map((pt) => pt[0]))
    expect(maxLon).toBeLessThanOrEqual(VIEWPORT.neLon + 0.01)
  })

  it('擦边只在视口外的 polygon（不相交）也会被裁为空', () => {
    // 紧贴视口东北角外一点点
    const justOutside = polygon([
      [114.405, 30.625],
      [114.415, 30.625],
      [114.415, 30.635],
      [114.405, 30.635],
      [114.405, 30.625],
    ])
    const { boundary } = clipBoundaryToViewport(justOutside, VIEWPORT)
    expect(boundary).toBeNull()
  })

  it('MultiPolygon：一部分在视口内、一部分在外，只保留视口内分块', () => {
    const mp: NarrativeNodeBoundary = {
      type: 'MultiPolygon',
      source: 'landuse_parcel',
      coordinates: [
        // 视口内
        [[
          [114.33, 30.57],
          [114.34, 30.57],
          [114.34, 30.58],
          [114.33, 30.58],
          [114.33, 30.57],
        ]],
        // 视口外（西边几公里）
        [[
          [113.90, 30.50],
          [113.92, 30.50],
          [113.92, 30.52],
          [113.90, 30.52],
          [113.90, 30.50],
        ]],
      ],
    }
    const { boundary, clippedAreaM2 } = clipBoundaryToViewport(mp, VIEWPORT)
    expect(boundary).not.toBeNull()
    expect(boundary!.type).toBe('MultiPolygon')
    const polys = boundary!.coordinates as number[][][][]
    expect(polys.length).toBe(1) // 只保留视口内那块
    expect(clippedAreaM2).toBeGreaterThan(0)
  })
})

describe('isPointInViewport', () => {
  it('视口内点返回 true', () => {
    expect(isPointInViewport({ lon: 114.35, lat: 30.58 }, VIEWPORT)).toBe(true)
  })

  it('视口外点返回 false', () => {
    expect(isPointInViewport({ lon: 113.90, lat: 30.50 }, VIEWPORT)).toBe(false)
  })
})
