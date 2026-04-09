import { describe, expect, it } from 'vitest'

import type { AreaProfile } from '../../../src/chat/types.js'
import { buildAnomalySignals, buildLivelihoodProfile, resolveLivelihoodPrimaryCategory } from '../../../src/evidence/areaInsight/livelihoodProfile.js'
import { buildOpportunitySignals } from '../../../src/evidence/areaInsight/opportunitySignals.js'

describe('resolveLivelihoodPrimaryCategory', () => {
  it('maps charging-service style categories to mobility instead of generic life service', () => {
    expect(resolveLivelihoodPrimaryCategory({
      categoryMain: '生活服务',
      categorySub: '共享充电宝',
      category: '共享充电宝',
    })).toBe('行')
  })
})

describe('buildLivelihoodProfile', () => {
  it('prefers meaningful livelihood primaries over low-signal labels', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `edu-${index}`,
        name: `大学样本${index + 1}`,
        categoryMain: '科教文化服务',
        categorySub: '大学',
        category: '大学',
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `charge-${index}`,
        name: `共享充电宝${index + 1}`,
        categoryMain: '生活服务',
        categorySub: '共享充电宝',
        category: '共享充电宝',
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `gate-${index}`,
        name: `出入口${index + 1}`,
        categoryMain: '交通设施服务',
        categorySub: '出入口',
        category: '出入口',
      })),
    ]

    const profile = buildLivelihoodProfile({ items })

    expect(profile?.preferredPrimaryCategory).toBe('学习')
    expect(profile?.dominantPrimary?.label).toBe('学习')
    expect(profile?.primaryCategories?.[0]?.label).toBe('学习')
    expect(profile?.dominantSecondary?.label).toBe('大学')
    expect(profile?.secondaryTop?.[0]?.label).toBe('大学')
    expect(profile?.lowSignalRatio).toBeGreaterThan(0.2)
    expect(profile?.rankingApplied).toBe(true)
  })

  it('demotes fallback primary when the second meaningful category is strong enough', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `finance-${index}`,
        name: `银行样本${index + 1}`,
        categoryMain: '金融保险服务',
        categorySub: '银行',
        category: '银行',
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `school-${index}`,
        name: `大学样本${index + 1}`,
        categoryMain: '科教文化服务',
        categorySub: '大学',
        category: '大学',
      })),
    ]

    const profile = buildLivelihoodProfile({ items })

    expect(profile?.preferredPrimaryCategory).toBe('其他')
    expect(profile?.dominantPrimary?.label).toBe('学习')
    expect(profile?.dominantPrimary?.count).toBe(4)
  })
})

describe('buildAnomalySignals', () => {
  it('surfaces structural concentration and low-signal warnings from the livelihood profile', () => {
    const profile: AreaProfile = {
      totalCount: 20,
      dominantCategories: [
        { label: '科教文化服务', count: 12, share: 0.6 },
        { label: '餐饮美食', count: 5, share: 0.25 },
      ],
      preferredPrimaryCategory: '学习',
      dominantPrimary: { label: '学习', count: 12, share: 0.6 },
      primaryCategories: [
        { label: '学习', count: 12, share: 0.6 },
        { label: '食', count: 5, share: 0.25 },
      ],
      dominantSecondary: { label: '大学', count: 9, share: 0.45 },
      secondaryTop: [
        { label: '大学', count: 9, share: 0.45 },
      ],
      lowSignalRatio: 0.3,
      lowSignalCount: 6,
      ringFootfall: [
        { label: '0-300m', count: 11, share: 0.55 },
        { label: '300-600m', count: 6, share: 0.3 },
      ],
      rankingApplied: true,
    }

    const signals = buildAnomalySignals(profile, [
      { label: '热点网格1', poiCount: 9 },
    ])

    expect(signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining([
      'mono_structure_risk',
      'core_cluster_risk',
      'low_signal_warning',
    ]))
  })

  it('uses more natural secondary-category wording in anomaly details', () => {
    const profile: AreaProfile = {
      totalCount: 24,
      dominantCategories: [
        { label: '餐饮美食', count: 14, share: 0.58 },
        { label: '购物服务', count: 6, share: 0.25 },
      ],
      preferredPrimaryCategory: '食',
      dominantPrimary: { label: '食', count: 14, share: 0.58 },
      primaryCategories: [
        { label: '食', count: 14, share: 0.58 },
        { label: '购', count: 6, share: 0.25 },
      ],
      dominantSecondary: { label: '地铁站', count: 4, share: 0.17 },
      secondaryTop: [
        { label: '地铁站', count: 4, share: 0.17 },
      ],
      lowSignalRatio: 0.05,
      lowSignalCount: 1,
      ringFootfall: [
        { label: '0-300m', count: 12, share: 0.5 },
      ],
      rankingApplied: true,
    }

    const signals = buildAnomalySignals(profile, [])
    const monoSignal = signals.find((signal) => signal.kind === 'mono_structure_risk')

    expect(monoSignal?.detail).toContain('地铁接驳')
    expect(monoSignal?.detail).not.toContain(' 地铁站')
  })
})

describe('buildOpportunitySignals', () => {
  it('separates scarcity, over-competition, mono-structure and complementary-gap signals', () => {
    const profile: AreaProfile = {
      totalCount: 24,
      dominantCategories: [
        { label: '科教文化服务', count: 12, share: 0.5 },
        { label: '餐饮美食', count: 8, share: 0.33 },
        { label: '交通设施服务', count: 4, share: 0.17 },
      ],
      preferredPrimaryCategory: '学习',
      dominantPrimary: { label: '学习', count: 12, share: 0.5 },
      primaryCategories: [
        { label: '学习', count: 12, share: 0.5 },
        { label: '食', count: 8, share: 0.33 },
        { label: '行', count: 4, share: 0.17 },
      ],
      dominantSecondary: { label: '大学', count: 10, share: 0.42 },
      secondaryTop: [
        { label: '大学', count: 10, share: 0.42 },
        { label: '中餐厅', count: 6, share: 0.25 },
      ],
      lowSignalRatio: 0.04,
      lowSignalCount: 1,
      ringFootfall: [
        { label: '0-300m', count: 13, share: 0.54 },
      ],
      rankingApplied: true,
    }

    const signals = buildOpportunitySignals({
      profile,
      competitionDensity: [
        { competition_key: '餐饮美食', poi_count: 10, avg_distance_m: 118 },
        { competition_key: '购物服务', poi_count: 3, avg_distance_m: 265 },
      ],
    })

    expect(signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining([
      'scarcity_opportunity',
      'over_competition_warning',
      'mono_structure_risk',
      'complementary_service_gap',
    ]))
  })
})
