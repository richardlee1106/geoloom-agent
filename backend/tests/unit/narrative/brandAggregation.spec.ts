import { describe, expect, it } from 'vitest'

import type { BrandCluster } from '../../../src/narrative/brandAggregation.js'
import { isBrandClusterEligible } from '../../../src/narrative/brandAggregation.js'
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
