import { describe, expect, it } from 'vitest'

import type { NarrativePoi } from '../../../src/narrative/contract.js'
import { buildPoiBusinessProfile, businessProfileFactClaim } from '../../../src/narrative/poiBusinessProfile.js'

function poi(id: string, name: string, categoryMain: string, categorySub: string): NarrativePoi {
  return {
    id,
    lon: 114.3,
    lat: 30.5,
    display_name: name,
    tier: 'medium',
    role: 'scene_evidence',
    category_main: categoryMain,
    category_sub: categorySub,
  }
}

describe('buildPoiBusinessProfile', () => {
  it('统计真实点位中的主类和中类业态倾向', () => {
    const profile = buildPoiBusinessProfile({
      pois: [
        poi('food-1', '张记热干面', '餐饮服务', '小吃快餐店'),
        poi('food-2', '老街牛肉粉', '餐饮服务', '小吃快餐店'),
        poi('food-3', '江城饭馆', '餐饮服务', '中餐厅'),
        poi('shop-1', '街角便利店', '购物服务', '便利店'),
        poi('shop-2', '邻里超市', '购物服务', '超市'),
        poi('life-1', '顺手快递', '生活服务', '物流速递'),
      ],
    })

    expect(profile?.sample_size).toBe(6)
    expect(profile?.dominant_main_types[0]).toMatchObject({ name: '餐饮服务', count: 3 })
    expect(profile?.dominant_sub_types[0]).toMatchObject({ name: '小吃快餐店', count: 2 })
    expect(profile?.summary_hint).toContain('小吃快餐店')
    expect(profile?.summary_hint).toContain('更集中')
  })

  it('过滤住宅、停车场、出入口等低价值类别', () => {
    const profile = buildPoiBusinessProfile({
      pois: [
        poi('home', '某小区', '商务住宅', '住宅区'),
        poi('park', '地下停车场', '道路附属设施', '停车场'),
        poi('gate', '东门出入口', '交通设施服务', '出入口'),
        poi('food-1', '甲餐馆', '餐饮服务', '中餐厅'),
        poi('food-2', '乙餐馆', '餐饮服务', '中餐厅'),
        poi('food-3', '丙餐馆', '餐饮服务', '中餐厅'),
      ],
    })

    expect(profile?.sample_size).toBe(3)
    expect(profile?.dominant_main_types.map((item) => item.name)).not.toContain('商务住宅')
    expect(profile?.dominant_sub_types.map((item) => item.name)).not.toContain('停车场')
    expect(profile?.summary_hint).toContain('中餐厅')
  })

  it('样本不足或信号不明显时不生成画像', () => {
    const profile = buildPoiBusinessProfile({
      pois: [
        poi('food-1', '甲餐馆', '餐饮服务', '中餐厅'),
        poi('shop-1', '甲便利店', '购物服务', '便利店'),
      ],
    })

    expect(profile).toBeUndefined()
  })

  it('生成可进入事实层的自然语言画像', () => {
    const profile = buildPoiBusinessProfile({
      pois: [
        poi('food-1', '甲小吃', '餐饮服务', '小吃快餐店'),
        poi('food-2', '乙小吃', '餐饮服务', '小吃快餐店'),
        poi('food-3', '丙饭馆', '餐饮服务', '中餐厅'),
      ],
    })

    expect(businessProfileFactClaim('测试片区', profile)).toContain('测试片区的地图点位里')
    expect(businessProfileFactClaim('测试片区', profile)).not.toContain('POI')
  })
})
