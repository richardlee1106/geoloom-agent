import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../../../src/app.js'
import type { NarrativeBuilder, NarrativeResponse } from '../../../src/narrative/contract.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

describe('POST /api/narrative', () => {
  it('returns a narrative v1 contract response from the isolated narrative route', async () => {
    const responseBody: NarrativeResponse = {
      session_id: 'session-test',
      state_version: 1,
      scene_profile: 'education_culture',
      lod: 'meso',
      viewport: {
        west: 114.32,
        south: 30.56,
        east: 114.36,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.575],
      },
      dominant_coverage: 1,
      candidate_count: 1,
      poi_density: 42,
      semantic_diversity: 0.8,
      regions: [
        {
          id: 'viewport-overview',
          display_name: '教育文化概览',
          role: 'scene_evidence',
          core_anchor: { id: 'viewport-center', lon: 114.34, lat: 30.575 },
          boundary: {
            type: 'Polygon',
            coordinates: [[
              [114.32, 30.56],
              [114.36, 30.56],
              [114.36, 30.59],
              [114.32, 30.59],
              [114.32, 30.56],
            ]],
          },
          visual_layer: {
            mode: 'region_glow',
            region_glow: {
              core: {
                type: 'Polygon',
                coordinates: [[
                  [114.32, 30.56],
                  [114.36, 30.56],
                  [114.36, 30.59],
                  [114.32, 30.59],
                  [114.32, 30.56],
                ]],
              },
              color: '#ef4444',
              opacity_profile: { core: 0.24, inner: 0.12, outer: 0.06 },
            },
          },
          pois: [],
          narrative_facts: [],
        },
      ],
      path: {
        nodes: [
          {
            region_id: 'viewport-overview',
            narration_role: 'core',
            transition_reason: '验证独立 narrative route。',
          },
        ],
        seed: 'seed-test',
        alternatives_count: 0,
      },
      narration: {
        tone: 'tour',
        chapters: [
          {
            region_id: 'viewport-overview',
            text: '这是一个契约测试响应。',
            length_ms: 8000,
          },
        ],
      },
      user_context: {
        time_label: '当前时段',
        weather_label: '天气未指定',
        preference_label: '通用解说',
        history_label: '首次进入',
      },
    }

    const narrative: NarrativeBuilder = {
      build: vi.fn(async () => responseBody),
    }
    const app = createApp({
      registry: new SkillRegistry(),
      version: '0.3.1-test',
      checkDatabaseHealth: async () => true,
      narrative,
    })
    await app.ready()

    const payload = {
      viewport: responseBody.viewport,
      tone: 'tour',
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/narrative',
      payload,
    })

    expect(response.statusCode).toBe(200)
    expect(narrative.build).toHaveBeenCalledWith(payload)
    expect(response.json()).toEqual(responseBody)

    await app.close()
  })
})
