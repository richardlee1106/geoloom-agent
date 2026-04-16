import { describe, expect, it, vi } from 'vitest'

import { LocalFallbackBridge } from '../../../../src/integration/jinaBridge.js'
import { createEntityAlignmentSkill } from '../../../../src/skills/entity_alignment/EntityAlignmentSkill.js'

describe('EntityAlignmentSkill', () => {
  it('can supplement broad-place nearby alignment with search-driven DB recalls', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const candidateName = String(params?.[0] || '')
      if (candidateName === '湖锦酒楼') {
        return {
          rows: [
            {
              id: 11,
              name: '湖锦酒楼',
              category_main: '餐饮美食',
              category_sub: '湖北菜',
              longitude: 114.401,
              latitude: 30.507,
            },
          ],
          rowCount: 1,
        }
      }

      return { rows: [], rowCount: 0 }
    })

    const skill = createEntityAlignmentSkill({
      bridge: new LocalFallbackBridge(),
      query,
    })

    const result = await skill.execute('align_and_rank', {
      web_results: [
        {
          title: '湖锦酒楼',
          snippet: '湖锦酒楼是光谷附近比较稳定的湖北菜馆之一。',
          url: 'https://example.com/a',
        },
      ],
      local_pois: [],
      category_key: 'food',
      category_main: '餐饮美食',
      search_driven_local_recall: true,
      disable_distance_bias: true,
      max_results: 10,
    }, {} as never)

    expect(result.ok).toBe(true)
    const data = result.data as {
      ranked_results: Array<{ name: string; verification: string }>
      alignment_summary: Record<string, unknown>
    }
    expect(data.ranked_results.some((item) => item.name === '湖锦酒楼' && item.verification === 'dual_verified')).toBe(true)
    expect(data.alignment_summary.search_recalled_local_pois).toBe(1)
    expect(query).toHaveBeenCalled()
  })
})
