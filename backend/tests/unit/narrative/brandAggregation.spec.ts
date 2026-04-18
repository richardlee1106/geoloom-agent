import { describe, expect, it } from 'vitest'

import type { BrandCluster } from '../../../src/narrative/brandAggregation.js'
import { extractBrandFromName, isBrandClusterEligible } from '../../../src/narrative/brandAggregation.js'
import type { EvidenceItem } from '../../../src/chat/types.js'

function makePoi(name: string): EvidenceItem {
  return {
    id: name,
    name,
    longitude: 114.33,
    latitude: 30.57,
  } as unknown as EvidenceItem
}

function makeCluster(partial: Partial<BrandCluster> & { brand: string }): BrandCluster {
  return {
    type: 'scenic',
    count: partial.members?.length ?? 0,
    members: [],
    center: { lon: 114.33, lat: 30.57 },
    ...partial,
  } as BrandCluster
}

describe('isBrandClusterEligible (taming 单点伪品牌)', () => {
  it('count >= 2 的 cluster 无脑放行', () => {
    const cluster = makeCluster({
      brand: '武汉天地',
      type: 'commercial',
      members: [makePoi('武汉天地A'), makePoi('武汉天地B')],
      count: 2,
    })
    expect(isBrandClusterEligible(cluster)).toBe(true)
  })

  it('count === 1 且成员名就是 brand 本身 → 视作主体，通过', () => {
    const cluster = makeCluster({
      brand: '黄鹤楼公园',
      type: 'scenic',
      members: [makePoi('黄鹤楼公园')],
      count: 1,
    })
    expect(isBrandClusterEligible(cluster)).toBe(true)
  })

  it('count === 1 且成员仅多出核心尾词（公园/广场/中心）→ 视作主体别名，通过', () => {
    const cluster = makeCluster({
      brand: '黄鹤楼',
      type: 'scenic',
      members: [makePoi('黄鹤楼公园')],
      count: 1,
    })
    expect(isBrandClusterEligible(cluster)).toBe(true)
  })

  it('count === 1 且成员是分店/驿站/代销点 → 被拦截', () => {
    // 这是"武汉天地XX分店"触发 commercial brand="武汉天地"，但视口内并没有真的武汉天地
    const cluster = makeCluster({
      brand: '武汉天地',
      type: 'commercial',
      members: [makePoi('武汉天地美食分店')],
      count: 1,
    })
    expect(isBrandClusterEligible(cluster)).toBe(false)
  })

  it('count === 1 且成员是"武汉生物工程学院实训基地" → 主体未出现在视口，被拦截', () => {
    const cluster = makeCluster({
      brand: '武汉生物工程学院',
      type: 'campus',
      members: [makePoi('武汉生物工程学院实训基地')],
      count: 1,
    })
    expect(isBrandClusterEligible(cluster)).toBe(false)
  })

  it('count === 0（空 members）直接拦截', () => {
    const cluster = makeCluster({
      brand: '黄鹤楼',
      type: 'scenic',
      members: [],
      count: 0,
    })
    expect(isBrandClusterEligible(cluster)).toBe(false)
  })
})

describe('extractBrandFromName - campus 保护规则', () => {
  it('医学院主体不应被抽成上位大学品牌', () => {
    expect(extractBrandFromName('武汉大学医学院')).toEqual({
      brand: null,
      type: null,
    })
  })

  it('高校前缀 + 小区尾部不应被抽成 campus 品牌', () => {
    expect(extractBrandFromName('武汉理工大学友谊小区')).toEqual({
      brand: null,
      type: null,
    })
  })

  it('老年大学不应被抽成 campus 品牌', () => {
    expect(extractBrandFromName('湖北省老年大学')).toEqual({
      brand: null,
      type: null,
    })
  })

  it('神学院不应被抽成 campus 品牌', () => {
    expect(extractBrandFromName('中南神学院')).toEqual({
      brand: null,
      type: null,
    })
  })
})

describe('extractBrandFromName - commercial 扩展词典', () => {
  it('万象城应能抽成商业综合体品牌', () => {
    expect(extractBrandFromName('武昌万象城')).toEqual({
      brand: '武昌万象城',
      type: 'commercial',
    })
  })

  it('商圈应能抽成商业综合体品牌', () => {
    expect(extractBrandFromName('光谷商圈')).toEqual({
      brand: '光谷商圈',
      type: 'commercial',
    })
  })
})
