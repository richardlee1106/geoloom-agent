import { describe, expect, it } from 'vitest'

import {
  buildNarrativeAreaTemplateSql,
  buildViewportBoundary,
  sanitizeKeywordLiteral,
} from '../../../src/narrative/postgisTemplateBuilder.js'
import { wgs84ToGcj02 } from '../../../src/narrative/gcj02.js'
import type { NarrativeViewport } from '../../../src/narrative/types.js'

// 覆盖武汉洪山视野的一个典型 viewport（WGS84）。
const VIEWPORT: NarrativeViewport = {
  swLon: 114.32,
  swLat: 30.56,
  neLon: 114.36,
  neLat: 30.59,
}

describe('sanitizeKeywordLiteral', () => {
  it('把单引号转义成两个单引号，避免 SQL 注入断字符串', () => {
    expect(sanitizeKeywordLiteral("武汉'天地"))
      .toBe("武汉''天地")
  })

  it('去掉两端空白', () => {
    expect(sanitizeKeywordLiteral('  武汉生物工程学院  '))
      .toBe('武汉生物工程学院')
  })

  it('截断到 40 字，避免 ILIKE 命中性能退化', () => {
    const longInput = '武'.repeat(60)
    expect(sanitizeKeywordLiteral(longInput).length).toBe(40)
  })

  it('空输入返回空字符串', () => {
    expect(sanitizeKeywordLiteral('')).toBe('')
  })
})

describe('buildNarrativeAreaTemplateSql - narrative_keyword_parcel_union', () => {
  it('把 keyword/searchRadius 正确注入 SQL 模板，且保留 ILIKE / BFS 结构', () => {
    const sql = buildNarrativeAreaTemplateSql({
      templateName: 'narrative_keyword_parcel_union',
      viewport: VIEWPORT,
      keyword: '武汉生物工程学院',
      searchRadiusM: 500,
      limit: 1,
    })

    // 关键字被包进 ILIKE 字面量
    expect(sql).toContain("p.name ILIKE '%武汉生物工程学院%'")
    // BFS 半径注入到 ST_DWithin / ST_Buffer
    expect(sql).toContain("ST_DWithin(a.geom::geography, s.geom::geography, 500)")
    expect(sql).toContain("ST_Buffer(ST_GeomFromText('POLYGON(")
    // viewport polygon 被构造进 AREA_GEOMETRY
    expect(sql).toContain('114.32 30.56')
    expect(sql).toContain('114.36 30.59')
    // 必要的空间函数存在（通过 SQLSandbox catalog 的防爆盾校验所需）
    expect(sql).toMatch(/ST_Intersects/u)
    expect(sql).toMatch(/ST_Contains/u)
    expect(sql).toMatch(/ST_Union/u)
    expect(sql).toMatch(/LIMIT 1/u)
  })

  it('搜索半径落在 [50, 5000] 合理区间之外时会被夹取', () => {
    const sqlLow = buildNarrativeAreaTemplateSql({
      templateName: 'narrative_keyword_parcel_union',
      viewport: VIEWPORT,
      keyword: '黄鹤楼',
      searchRadiusM: 5,
      limit: 1,
    })
    // searchRadiusM=5 会被 Math.max(50, Math.min(5, 5000)) 夹到下界 50
    expect(sqlLow.match(/ST_DWithin[^,]+,[^,]+,\s*(\d+)\)/u)?.[1]).toBe('50')

    const sqlHigh = buildNarrativeAreaTemplateSql({
      templateName: 'narrative_keyword_parcel_union',
      viewport: VIEWPORT,
      keyword: '黄鹤楼',
      searchRadiusM: 99999,
      limit: 1,
    })
    expect(sqlHigh.match(/ST_DWithin[^,]+,[^,]+,\s*(\d+)\)/u)?.[1]).toBe('5000')
  })

  it('对 keyword 里的单引号做 SQL 转义', () => {
    const sql = buildNarrativeAreaTemplateSql({
      templateName: 'narrative_keyword_parcel_union',
      viewport: VIEWPORT,
      keyword: "test'injection",
      limit: 1,
    })
    expect(sql).toContain("'%test''injection%'")
    // 字面量仍然闭合（等号数量为偶数）
    const quoteCount = (sql.match(/'/gu) || []).length
    expect(quoteCount % 2).toBe(0)
  })
})

describe('buildNarrativeAreaTemplateSql - narrative_keyword_road_block_union', () => {
  it('把关键字和路网闭合地块探索结构正确注入 SQL 模板', () => {
    const sql = buildNarrativeAreaTemplateSql({
      templateName: 'narrative_keyword_road_block_union',
      viewport: VIEWPORT,
      keyword: '湖北大学',
      searchRadiusM: 500,
      limit: 1,
    })

    expect(sql).toContain("p.name ILIKE '%湖北大学%'")
    expect(sql).toContain('FROM road_blocks b')
    expect(sql).toContain("'road_block' AS source")
    expect(sql).toContain('ST_DWithin(b.geom::geography, s.geom::geography, 500)')
    expect(sql).toMatch(/ST_Contains/u)
    expect(sql).toMatch(/ST_Intersects/u)
    expect(sql).toMatch(/ST_Union/u)
    expect(sql).toMatch(/LIMIT 1/u)
  })
})

describe('buildViewportBoundary', () => {
  it('把 WGS84 viewport 四角转换成 GCJ02，供前端直接贴合高德底图', () => {
    const boundary = buildViewportBoundary(VIEWPORT)
    const ring = boundary.coordinates[0]
    const [expectedSwLon, expectedSwLat] = wgs84ToGcj02(VIEWPORT.swLon, VIEWPORT.swLat)
    const [expectedNeLon, expectedNeLat] = wgs84ToGcj02(VIEWPORT.neLon, VIEWPORT.neLat)

    expect(ring[0]?.[0]).toBeCloseTo(expectedSwLon, 8)
    expect(ring[0]?.[1]).toBeCloseTo(expectedSwLat, 8)
    expect(ring[2]?.[0]).toBeCloseTo(expectedNeLon, 8)
    expect(ring[2]?.[1]).toBeCloseTo(expectedNeLat, 8)
    expect(ring[0]?.[0]).not.toBeCloseTo(VIEWPORT.swLon, 4)
    expect(ring[0]?.[1]).not.toBeCloseTo(VIEWPORT.swLat, 4)
  })
})
