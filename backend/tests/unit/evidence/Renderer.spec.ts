import { describe, expect, it } from 'vitest'

import { Renderer } from '../../../src/evidence/Renderer.js'

describe('Renderer', () => {
  const renderer = new Renderer()

  it('renders poi_list evidence into fixed deterministic text', () => {
    const answer = renderer.render({
      type: 'poi_list',
      anchor: {
        placeName: '武汉大学',
        displayName: '武汉大学',
        resolvedPlaceName: '武汉大学',
      },
      items: [
        {
          name: 'luckin coffee',
          category: '咖啡',
          distance_m: 123.7,
        },
      ],
      meta: {
        radiusM: 800,
        targetCategory: '咖啡',
      },
    })

    expect(answer).toMatch(/武汉大学/)
    expect(answer).toMatch(/luckin coffee/)
    expect(answer).toMatch(/800/)
  })

  it('lists every nearby poi when the result set is still compact', () => {
    const answer = renderer.render({
      type: 'poi_list',
      anchor: {
        placeName: '湖北大学',
        displayName: '湖北大学',
        resolvedPlaceName: '湖北大学武昌校区',
      },
      items: [
        { name: '湖北大学地铁站E口', category: '地铁站', distance_m: 372 },
        { name: '湖北大学地铁站A口', category: '地铁站', distance_m: 448 },
        { name: '湖北大学地铁站D口', category: '地铁站', distance_m: 448 },
        { name: '湖北大学地铁站C口', category: '地铁站', distance_m: 475 },
        { name: '湖北大学地铁站B口', category: '地铁站', distance_m: 566 },
        { name: '秦园路(地铁站)', category: '地铁站', distance_m: 612 },
      ],
      meta: {
        radiusM: 800,
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/找到 6 个地铁站相关地点/)
    expect(answer).toMatch(/1\. 湖北大学地铁站E口/)
    expect(answer).toMatch(/6\. 秦园路\(地铁站\)/)
  })

  it('renders transport evidence into a nearest-station sentence', () => {
    const answer = renderer.render({
      type: 'transport',
      anchor: {
        placeName: '武汉大学',
        displayName: '武汉大学',
        resolvedPlaceName: '武汉大学',
      },
      items: [
        {
          name: '小洪山地铁站A口',
          category: '地铁站',
          distance_m: 1027.9,
        },
      ],
      meta: {
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/武汉大学/)
    expect(answer).toMatch(/小洪山地铁站A口/)
    expect(answer).toMatch(/1028|1027.9/)
  })

  it('lists exits for the nearest metro station and identifies the closest exit', () => {
    const answer = renderer.render({
      type: 'transport',
      anchor: {
        placeName: '湖北大学',
        displayName: '湖北大学',
        resolvedPlaceName: '湖北大学武昌校区',
      },
      items: [
        {
          name: '湖北大学地铁站E口',
          category: '地铁站',
          distance_m: 464.8,
        },
        {
          name: '湖北大学地铁站A口',
          category: '地铁站',
          distance_m: 558.9,
        },
        {
          name: '湖北大学地铁站D口',
          category: '地铁站',
          distance_m: 559.5,
        },
        {
          name: '湖北大学(地铁站)',
          category: '地铁站',
          distance_m: 571.5,
        },
        {
          name: '湖北大学地铁站C口',
          category: '地铁站',
          distance_m: 592.8,
        },
        {
          name: '湖北大学地铁站B口',
          category: '地铁站',
          distance_m: 706.2,
        },
      ],
      meta: {
        targetCategory: '地铁站',
      },
    })

    expect(answer).toMatch(/湖北大学武昌校区/)
    expect(answer).toMatch(/湖北大学地铁站/)
    expect(answer).toMatch(/E口/)
    expect(answer).toMatch(/A口、D口、C口、B口|E口、A口、D口、C口、B口/)
    expect(answer).toMatch(/最近|最近的出口/)
  })

  it('renders area-overview evidence into a concise insight summary', () => {
    const answer = renderer.render({
      type: 'area_overview',
      anchor: {
        placeName: '当前区域',
        displayName: '当前区域',
        resolvedPlaceName: '当前区域',
      },
      items: [
        {
          name: '湖北大学地铁站E口',
          category: '地铁站',
          categoryMain: '交通设施服务',
          distance_m: 120,
        },
        {
          name: '武昌鱼馆',
          category: '中餐厅',
          categoryMain: '餐饮美食',
          distance_m: 180,
        },
        {
          name: '校园便利店',
          category: '便利店',
          categoryMain: '购物服务',
          distance_m: 260,
        },
        {
          name: '咖啡实验室',
          category: '咖啡',
          categoryMain: '餐饮美食',
          distance_m: 320,
        },
      ],
      buckets: [
        { label: '餐饮美食', value: 2 },
        { label: '交通设施服务', value: 1 },
        { label: '购物服务', value: 1 },
      ],
      meta: {
        radiusM: 1200,
        targetCategory: '区域洞察',
      },
    })

    expect(answer).toMatch(/主导业态/)
    expect(answer).toMatch(/活力热点/)
    expect(answer).toMatch(/机会/)
  })
})
