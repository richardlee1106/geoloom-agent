import { describe, expect, it } from 'vitest'

import { classifyNarrativeEntity } from '../../../src/narrative/entityClassifier.js'

describe('classifyNarrativeEntity', () => {
  it.each([
    ['湖北大学学生宿舍', '科教文化服务', '宿舍'],
    ['湖北大学家属区', '商务住宅', '住宅区'],
    ['湖北大学综合服务中心', '生活服务', '服务中心'],
    ['湖北大学3号楼', '科教文化服务', '楼栋'],
  ])('excludes micro facilities from narrative rendering and main chain: %s', (name, categoryMain, categorySub) => {
    const result = classifyNarrativeEntity({ name, categoryMain, categorySub })

    expect(result.role).toBe('micro_facility')
    expect(result.tier).toBe('excluded')
    expect(result.mainChainEligible).toBe(false)
    expect(result.representative).toBe(false)
  })


  it.each([
    ['武汉理工大学余家头校区图书馆', '科教文化服务', '图书馆'],
    ['湖北大学图书馆', '科教文化服务', '图书馆'],
  ])('校内设施只能作为支撑证据，不能成为同级片区：%s', (name, categoryMain, categorySub) => {
    const result = classifyNarrativeEntity({ name, categoryMain, categorySub })

    expect(result.role).toBe('scene_evidence')
    expect(result.tier).toBe('medium')
    expect(result.mainChainEligible).toBe(false)
    expect(result.representative).toBe(false)
  })
  it('allows a large university AOI to become primary_region', () => {
    const result = classifyNarrativeEntity({
      name: '武汉大学',
      categoryMain: '科教文化服务',
      categorySub: '高等院校',
      fclass: 'university',
      areaSqm: 2_000_000,
      isAoiEntity: true,
    })

    expect(result.role).toBe('primary_region')
    expect(result.tier).toBe('core')
    expect(result.mainChainEligible).toBe(true)
    expect(result.representative).toBe(true)
  })

  it('keeps a university point without stable AOI area as support_region rather than primary_region', () => {
    const result = classifyNarrativeEntity({
      name: '武汉大学',
      categoryMain: '科教文化服务',
      categorySub: '高等院校',
    })

    expect(result.role).toBe('support_region')
    expect(result.tier).toBe('strong')
    expect(result.mainChainEligible).toBe(true)
    expect(result.representative).toBe(true)
  })

  it.each([
    ['湖北大学(地铁站)', '交通设施服务', '地铁站'],
    ['友谊大道湖北大学(公交站)', '交通设施服务', '公交站'],
  ])('将本地交通接驳点降级为弱证据：%s', (name, categoryMain, categorySub) => {
    const result = classifyNarrativeEntity({ name, categoryMain, categorySub })

    expect(result.role).toBe('background_ecology')
    expect(result.tier).toBe('weak')
    expect(result.mainChainEligible).toBe(false)
    expect(result.representative).toBe(false)
  })


  it.each([
    ['中国铁路武汉局集团有限公司党校', '科教文化服务', '学校'],
    ['武汉大学人民医院', '医疗保健服务', '综合医院'],
    ['同济医院光谷院区', '医疗保健服务', '专科医院'],
    ['None', '未分类', ''],
    ['武汉和平', '地名地址信息', '普通地名'],
    ['团结', '地名地址信息', '普通地名'],
  ])('从 narrative 主链和渲染中剔除非目标实体：%s', (name, categoryMain, categorySub) => {
    const result = classifyNarrativeEntity({ name, categoryMain, categorySub })

    expect(result.tier).toBe('excluded')
    expect(result.mainChainEligible).toBe(false)
    expect(result.representative).toBe(false)
  })
  it('prevents a single chain branch from becoming primary_region', () => {
    const result = classifyNarrativeEntity({
      name: '星巴克（群光广场店）',
      categoryMain: '餐饮美食',
      categorySub: '咖啡厅',
      brandChainCount: 1,
      supportCount: 0,
    })

    expect(result.role).toBe('background_ecology')
    expect(result.tier).toBe('medium')
    expect(result.mainChainEligible).toBe(false)
    expect(result.representative).toBe(false)
  })

  it('allows a large commercial AOI with stable area to become primary_region', () => {
    const result = classifyNarrativeEntity({
      name: '武汉天地',
      categoryMain: '购物服务',
      categorySub: '购物中心',
      areaSqm: 80_000,
      isAoiEntity: true,
    })

    expect(result.role).toBe('primary_region')
    expect(result.tier).toBe('core')
    expect(result.mainChainEligible).toBe(true)
    expect(result.representative).toBe(true)
  })
})
