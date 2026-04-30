import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import V4EvidencePanel from '../V4EvidencePanel.vue'

describe('V4EvidencePanel', () => {
  it('renders similar-region reference dimensions and per-region breakdowns', () => {
    const wrapper = mount(V4EvidencePanel, {
      props: {
        message: {
          evidenceView: {
            type: 'semantic_candidate',
            anchor: {
              resolvedPlaceName: '武汉大学',
            },
            items: [],
            regions: [
              {
                regionId: 'region_wuda',
                name: '街道口-武大商圈',
                rank: 1,
                score: 0.91,
                summary: '高校密集、咖啡和夜间活跃度较高',
                dimensions: [
                  { key: 'campus_vibe', label: '校园氛围', score: 0.89 },
                  { key: 'food_density', label: '餐饮密度', score: 0.8 },
                ],
              },
            ],
            meta: {
              referenceDimensions: [
                { key: 'campus_vibe', label: '校园氛围', score: 0.9 },
                { key: 'food_density', label: '餐饮密度', score: 0.82 },
              ],
            },
          },
          toolCalls: [],
          sessionId: 'session-similar',
        },
        providerReady: true,
        providerLabel: 'GeoLoom Agent',
        modelId: 'test-model',
      },
    })

    expect(wrapper.text()).toContain('语义相似片区证据')
    expect(wrapper.text()).toContain('参考维度')
    expect(wrapper.text()).toContain('校园氛围 90%')
    expect(wrapper.text()).toContain('街道口-武大商圈')
    expect(wrapper.text()).toContain('餐饮密度')
    expect(wrapper.text()).toContain('89%')
  })
})
