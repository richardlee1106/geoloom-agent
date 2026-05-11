import { describe, expect, it } from 'vitest'

import { createApp } from '../../../src/app.js'
import type { NarrativeBuilder, NarrativeRequest, NarrativeResponse } from '../../../src/narrative/contract.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

function response(): NarrativeResponse {
  return {
    session_id: 'route-session',
    state_version: 1,
    scene_profile: 'mixed_urban',
    lod: 'micro',
    viewport: { west: 114.3, south: 30.5, east: 114.4, north: 30.6, zoom: 14, center: [114.35, 30.55] },
    dominant_coverage: 0.5,
    candidate_count: 1,
    poi_density: 10,
    semantic_diversity: 0.5,
    regions: [],
    path: { nodes: [], seed: 'route-seed', alternatives_count: 0 },
    narration: { chapters: [], tone: 'tour' },
    user_context: { time_label: '当前时段', weather_label: '天气未指定', preference_label: '通用解说', history_label: '首次进入' },
  }
}

describe('narrative routes', () => {
  it('returns enrichment job state by job id', async () => {
    const narrative: NarrativeBuilder = {
      async build(_input: NarrativeRequest) {
        return response()
      },
      getEnrichmentJob(jobId: string) {
        if (jobId !== 'job-1') return undefined
        return {
          job_id: 'job-1',
          status: 'completed',
          summary: {
            job_id: 'job-1',
            mode: 'async',
            status: 'completed',
            phase: 'enriched',
            total_region_count: 1,
            completed_region_count: 1,
            cached_region_count: 0,
            source_count: 2,
          },
          response: response(),
        }
      },
    }
    const app = createApp({
      registry: new SkillRegistry(),
      version: 'test',
      checkDatabaseHealth: async () => true,
      narrative,
    })

    const result = await app.inject({ method: 'GET', url: '/api/narrative/enrichment/job-1' })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({
      job_id: 'job-1',
      status: 'completed',
      summary: { source_count: 2 },
    })
  })

  it('streams enrichment job state as an SSE event', async () => {
    const narrative: NarrativeBuilder = {
      async build(_input: NarrativeRequest) {
        return response()
      },
      getEnrichmentJob(jobId: string) {
        if (jobId !== 'job-1') return undefined
        return {
          job_id: 'job-1',
          status: 'completed',
          summary: {
            job_id: 'job-1',
            mode: 'async',
            status: 'completed',
            phase: 'enriched',
            total_region_count: 1,
            completed_region_count: 1,
            cached_region_count: 0,
            source_count: 2,
          },
          response: response(),
        }
      },
    }
    const app = createApp({
      registry: new SkillRegistry(),
      version: 'test',
      checkDatabaseHealth: async () => true,
      narrative,
    })

    const result = await app.inject({ method: 'GET', url: '/api/narrative/enrichment/job-1/events' })

    expect(result.statusCode).toBe(200)
    expect(result.headers['content-type']).toContain('text/event-stream')
    expect(result.body).toContain('event: enrichment')
    const dataLine = result.body.split('\n').find((line) => line.startsWith('data: '))
    expect(JSON.parse(String(dataLine || '').slice('data: '.length))).toMatchObject({
      job_id: 'job-1',
      status: 'completed',
      summary: { source_count: 2 },
    })
  })

  it('returns 404 for missing enrichment job', async () => {
    const narrative: NarrativeBuilder = {
      async build(_input: NarrativeRequest) {
        return response()
      },
      getEnrichmentJob() {
        return undefined
      },
    }
    const app = createApp({
      registry: new SkillRegistry(),
      version: 'test',
      checkDatabaseHealth: async () => true,
      narrative,
    })

    const result = await app.inject({ method: 'GET', url: '/api/narrative/enrichment/missing' })

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body)).toMatchObject({ success: false, error: { code: 'narrative_enrichment_not_found' } })
  })
})
