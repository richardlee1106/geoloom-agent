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
})
