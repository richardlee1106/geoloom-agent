import { describe, expect, it } from 'vitest'

import { fetchSpatialFeaturesFromDatabase } from '../../../src/spatial/fetchSpatialFeatures.js'

function row(id: string, name: string) {
  return {
    id,
    name,
    category_main: '餐饮服务',
    category_sub: '小吃',
    brand_category: '小吃',
    longitude: 114.3,
    latitude: 30.6,
    geom_longitude: 114.3,
    geom_latitude: 30.6,
    semantic_score: 0.88,
    semantic_distance: 0.24,
    fusion_score: 0.82,
  }
}

describe('fetchSpatialFeaturesFromDatabase', () => {
  it('uses narrative timeout and semantic vector ordering when a 512-d vector is provided', async () => {
    const calls: Array<{ sql: string; params?: unknown[]; timeoutMs?: number }> = []
    const vector = Array.from({ length: 512 }, (_, index) => index / 512)
    const features = await fetchSpatialFeaturesFromDatabase({
      bounds: [114.2, 30.5, 114.4, 30.7],
      limit: 1200,
      timeoutMs: 1800,
      semanticQueryVector: vector,
      semanticWeight: 0.55,
      semanticCandidateLimit: 3600,
    }, async (sql, params, timeoutMs) => {
      calls.push({ sql, params, timeoutMs })
      return { rows: [row('1', '山海关路李记鸡冠饺')], rowCount: 1 }
    })

    expect(features[0]?.properties.semantic_score).toBe(0.88)
    expect(calls[0]?.timeoutMs).toBe(1800)
    expect(calls[0]?.sql).toContain('embedding <=>')
    expect(calls[0]?.sql).toContain('WITH spatial_candidates AS')
    expect(calls[0]?.sql).toContain('LIMIT $6')
    expect(calls[0]?.sql).toContain('fusion_score DESC')
    expect(calls[0]?.params?.at(-2)).toBe(3600)
    expect(calls[0]?.params?.at(-1)).toBe(1200)
    expect(calls[0]?.params?.some((item) => typeof item === 'string' && item.startsWith('['))).toBe(true)
  })

  it('falls back to hard spatial SQL when pgvector semantic query fails', async () => {
    const calls: string[] = []
    const vector = Array.from({ length: 512 }, (_, index) => index / 512)
    const features = await fetchSpatialFeaturesFromDatabase({
      bounds: [114.2, 30.5, 114.4, 30.7],
      limit: 1200,
      timeoutMs: 1800,
      semanticQueryVector: vector,
    }, async (sql) => {
      calls.push(sql)
      if (sql.includes('embedding <=>')) throw new Error('vector column missing')
      return { rows: [row('2', '沙湖公园')], rowCount: 1 }
    })

    expect(features[0]?.properties.name).toBe('沙湖公园')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('embedding <=>')
    expect(calls[1]).not.toContain('embedding <=>')
    expect(calls[1]).toContain('ORDER BY id ASC')
  })
})
