import { describe, expect, it } from 'vitest'

import { createApp } from '../../../src/app.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'

describe('GET /api/geo/health', () => {
  it('returns explicit dependency modes and degraded dependencies', async () => {
    const app = createApp({
      registry: new SkillRegistry(),
      version: '0.3.1-test',
      checkDatabaseHealth: async () => true,
      chat: {
        createWriter() {
          throw new Error('not used in health tests')
        },
        async handle() {
          throw new Error('not used in health tests')
        },
        async getHealth() {
          return {
            provider_ready: false,
            llm: {
              ready: false,
              provider: 'openai-compatible',
              model: null,
            },
            memory: {
              ready: true,
              short_term: {
                name: 'short_term_memory',
                ready: true,
                mode: 'fallback',
                degraded: true,
                reason: 'remote_store_unavailable',
              },
            },
            dependencies: {
              short_term_memory: {
                name: 'short_term_memory',
                ready: true,
                mode: 'fallback',
                degraded: true,
                reason: 'remote_store_unavailable',
              },
              spatial_vector: {
                name: 'spatial_vector',
                ready: true,
                mode: 'fallback',
                degraded: true,
                reason: 'remote_request_failed',
              },
            },
            degraded_dependencies: ['llm_provider', 'short_term_memory', 'spatial_vector'],
            metrics: {
              requests_total: 8,
              latency: {
                count: 8,
                p50_ms: 320,
                p95_ms: 1180,
              },
              sql: {
                validation_attempts: 5,
                validation_passed: 4,
                validation_failed: 1,
              },
              sql_valid_rate: 0.8,
              answers: {
                total: 8,
                grounded: 6,
                ungrounded: 2,
              },
              evidence_grounded_answer_rate: 0.75,
            },
          }
        },
      },
    })
    await app.ready()

    const response = await app.inject({
      method: 'GET',
      url: '/api/geo/health',
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json()

    expect(payload.provider_ready).toBe(false)
    expect(payload.memory.short_term.mode).toBe('fallback')
    expect(payload.dependencies.spatial_vector.mode).toBe('fallback')
    expect(payload.metrics).toEqual({
      requests_total: 8,
      latency: {
        count: 8,
        p50_ms: 320,
        p95_ms: 1180,
      },
      sql: {
        validation_attempts: 5,
        validation_passed: 4,
        validation_failed: 1,
      },
      sql_valid_rate: 0.8,
      answers: {
        total: 8,
        grounded: 6,
        ungrounded: 2,
      },
      evidence_grounded_answer_rate: 0.75,
    })
    expect(payload.degraded_dependencies).toEqual(expect.arrayContaining([
      'llm_provider',
      'short_term_memory',
      'spatial_vector',
    ]))

    await app.close()
  })
})
