import { describe, expect, it } from 'vitest'

import { applyStreamEvent, createAssistantRun } from './chatStreamState'

describe('chatStreamState', () => {
  it('collects trace, stage and refined evidence into a single run state', () => {
    let run = createAssistantRun('武汉大学附近有哪些咖啡店？')

    run = applyStreamEvent(run, 'trace', {
      provider_ready: false,
      degraded_dependencies: ['llm_provider'],
    })
    run = applyStreamEvent(run, 'stage', { name: 'intent' })
    run = applyStreamEvent(run, 'intent_preview', {
      displayAnchor: '武汉大学',
      targetCategory: '咖啡',
      confidence: 0.92,
    })
    run = applyStreamEvent(run, 'refined_result', {
      answer: '武汉大学附近有 luckin coffee。',
      tool_calls: [
        {
          id: 'tool_1',
          skill: 'postgis',
          action: 'execute_spatial_sql',
          status: 'done',
        },
      ],
      results: {
        evidence_view: {
          type: 'poi_list',
          anchor: {
            resolvedPlaceName: '武汉大学',
          },
          items: [
            {
              id: 1,
              name: 'luckin coffee',
              categorySub: '咖啡',
              distance_m: 123,
            },
          ],
        },
        stats: {
          query_type: 'nearby_poi',
        },
      },
    })
    run = applyStreamEvent(run, 'done', { duration_ms: 1200 })

    expect(run.currentStage).toBe('intent')
    expect(run.intentPreview.displayAnchor).toBe('武汉大学')
    expect(run.answer).toContain('luckin coffee')
    expect(run.toolCalls).toHaveLength(1)
    expect(run.evidenceView.type).toBe('poi_list')
    expect(run.stats.query_type).toBe('nearby_poi')
    expect(run.degradedDependencies).toContain('llm_provider')
    expect(run.complete).toBe(true)
  })
})
