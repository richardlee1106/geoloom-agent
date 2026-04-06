import { describe, expect, it } from 'vitest'

import { resolveAnchorAction } from '../../../../src/skills/postgis/actions/resolveAnchor.js'

describe('resolveAnchorAction', () => {
  it('returns an exact match when the place name matches directly', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '武汉大学',
        role: 'primary',
      },
      {
        searchCandidates: async () => [
          {
            id: 1,
            name: '武汉大学',
            lon: 114.3655,
            lat: 30.5431,
            category_big: '科教文化服务',
            category_mid: '学校',
            category_small: '高等院校',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.resolved_place_name).toBe('武汉大学')
    expect(result.data?.anchor.source).toBe('poi_search')
  })

  it('normalizes school aliases and prefers the canonical school entity', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '华师一附中',
      },
      {
        searchCandidates: async () => [
          {
            id: 10,
            name: '华中师范大学第一附属中学',
            lon: 114.40,
            lat: 30.49,
            category_big: '科教文化服务',
            category_mid: '学校',
            category_small: '中学',
          },
          {
            id: 11,
            name: '华师一附中东门',
            lon: 114.401,
            lat: 30.491,
            category_big: '科教文化服务',
            category_mid: '学校',
            category_small: '中学',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.resolved_place_name).toBe('华中师范大学第一附属中学')
    expect(result.data?.anchor.poi_id).toBe(10)
  })

  it('accepts LLM-style anchor_text payloads as the place name input', async () => {
    const result = await resolveAnchorAction(
      {
        // Simulate Anthropic-compatible tool payloads from real provider calls.
        anchor_text: '武汉大学',
        role: 'primary',
      },
      {
        searchCandidates: async () => [
          {
            id: 12,
            name: '武汉大学',
            lon: 114.3655,
            lat: 30.5431,
            category_big: '科教文化服务',
            category_mid: '学校',
            category_small: '高等院校',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.place_name).toBe('武汉大学')
    expect(result.data?.anchor.resolved_place_name).toBe('武汉大学')
    expect(result.data?.anchor.source).toBe('poi_search')
  })

  it('accepts real-world anchor_name payloads from live tool calling', async () => {
    const result = await resolveAnchorAction(
      {
        anchor_name: '武汉大学',
        role: 'primary',
      },
      {
        searchCandidates: async () => [
          {
            id: 13,
            name: '武汉大学',
            lon: 114.3655,
            lat: 30.5431,
            category_big: '科教文化服务',
            category_mid: '学校',
            category_small: '高等院校',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.place_name).toBe('武汉大学')
    expect(result.data?.anchor.resolved_place_name).toBe('武汉大学')
    expect(result.data?.anchor.source).toBe('poi_search')
  })

  it('falls back to fuzzy candidate scoring when there is no exact match', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '光谷步行街',
      },
      {
        searchCandidates: async () => [
          {
            id: 21,
            name: '光谷步行街广场',
            lon: 114.41,
            lat: 30.50,
            category_big: '风景名胜',
            category_mid: '公园广场',
            category_small: '广场',
          },
          {
            id: 22,
            name: '步行街便利店',
            lon: 114.42,
            lat: 30.50,
            category_big: '购物服务',
            category_mid: '便利店',
            category_small: '便利店',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.poi_id).toBe(21)
  })

  it('prefers the main school entity over derived campus facilities', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '武汉大学',
      },
      {
        searchCandidates: async () => [
          {
            id: 31,
            name: '武汉大学保卫一分部(文理学部)',
            lon: 114.364342,
            lat: 30.532812,
            category_main: '科教文化服务',
            category_sub: '学校',
          },
          {
            id: 32,
            name: '武汉大学',
            lon: 114.364339,
            lat: 30.536334,
            category_main: '科教文化服务',
            category_sub: '学校',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.resolved_place_name).toBe('武汉大学')
    expect(result.data?.anchor.poi_id).toBe(32)
  })

  it('prefers a canonical campus school entity over an exact-name non-school poi', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '湖北大学',
      },
      {
        searchCandidates: async () => [
          {
            id: 319490,
            name: '湖北大学',
            lon: 114.26762399994766,
            lat: 30.58676000017391,
            category_main: '科教文化服务',
            category_sub: '科教文化场所',
          },
          {
            id: 319491,
            name: '湖北大学(武昌校区)',
            lon: 114.33412099978432,
            lat: 30.57687000005052,
            category_main: '科教文化服务',
            category_sub: '学校',
          },
          {
            id: 319492,
            name: '湖北大学-教4',
            lon: 114.333922,
            lat: 30.577112,
            category_main: '科教文化服务',
            category_sub: '学校',
          },
        ],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.resolved_place_name).toBe('湖北大学(武昌校区)')
    expect(result.data?.anchor.poi_id).toBe(319491)
    expect(result.data?.anchor.lon).toBeCloseTo(114.33412099978432)
    expect(result.data?.anchor.lat).toBeCloseTo(30.57687000005052)
  })

  it('returns an unresolved anchor when no candidate matches', async () => {
    const result = await resolveAnchorAction(
      {
        place_name: '不存在的锚点',
      },
      {
        searchCandidates: async () => [],
      },
    )

    expect(result.ok).toBe(true)
    expect(result.data?.anchor.source).toBe('unresolved')
    expect(result.data?.anchor.resolved_place_name).toBe('不存在的锚点')
  })
})
