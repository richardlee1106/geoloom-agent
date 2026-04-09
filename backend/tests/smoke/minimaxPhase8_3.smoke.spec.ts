import { describe, expect, it } from 'vitest'

import { loadRuntimeEnv } from '../../src/config/loadRuntimeEnv.js'
import { buildRegressionApp, parseSSE } from '../integration/helpers/chatRegressionHarness.js'
import { minimaxPhase83SmokeCases } from './minimaxPhase8_3.corpus.js'

loadRuntimeEnv()

const perQueryTimeoutMs = Number(String(process.env.MINIMAX_SMOKE_TIMEOUT_MS || '45000').replace(/_/g, ''))
const minimaxReady = Boolean(
  String(process.env.LLM_API_KEY || '').trim()
  && String(process.env.LLM_MODEL || '').trim()
  && /minimax/i.test(String(process.env.LLM_BASE_URL || '')),
)

function expectEvidencePopulation(refined: Record<string, any>) {
  const evidenceView = refined.results?.evidence_view || {}
  const type = String(evidenceView.type || '')

  if (type === 'comparison') {
    expect(Array.isArray(evidenceView.pairs)).toBe(true)
    expect(evidenceView.pairs.length).toBeGreaterThan(0)
    return
  }

  if (type === 'semantic_candidate') {
    expect(Array.isArray(evidenceView.regions)).toBe(true)
    expect(evidenceView.regions.length).toBeGreaterThan(0)
    return
  }

  expect(Array.isArray(evidenceView.items)).toBe(true)
  expect(evidenceView.items.length).toBeGreaterThan(0)
}

describe('MiniMax Phase 8.3 smoke', () => {
  for (const query of minimaxPhase83SmokeCases) {
    it.skipIf(!minimaxReady)(`uses MiniMax as the real orchestration provider for ${query.id}`, async () => {
      const app = buildRegressionApp({
        providerMode: 'env_default',
      })
      await app.ready()

      const health = await app.inject({
        method: 'GET',
        url: '/api/geo/health',
      })
      const healthPayload = health.json()

      expect(healthPayload.llm.provider).toContain('minimax')
      expect(healthPayload.provider_ready).toBe(true)

      const response = await app.inject({
        method: 'POST',
        url: '/api/geo/chat',
        payload: {
          messages: [{ role: 'user', content: query.query }],
          options: {
            requestId: query.id,
            ...(query.requestOptions || {}),
          },
        },
      })

      expect(response.statusCode).toBe(200)
      const events = parseSSE(response.body)
      const refined = events.find((item) => item.event === 'refined_result')?.data
      expect(refined).toBeTruthy()
      const searchableOutput = [
        String(refined.answer || ''),
        JSON.stringify(refined.results.evidence_view || {}),
      ].join('\n')
      const anchorText = JSON.stringify(refined.results?.evidence_view?.anchor || {})

      expect(refined.results.stats.query_type).toBe(query.expectedQueryType)
      expect(refined.results.evidence_view.type).toBe(query.expectedEvidenceType)
      expectEvidencePopulation(refined)

      if (query.expectedAnchorKeyword) {
        expect(anchorText).toContain(query.expectedAnchorKeyword)
      }

      if (query.expectedKeyword) {
        expect(searchableOutput).toContain(query.expectedKeyword)
      }

      expect(events.at(-1)?.event).toBe('done')

      await app.close()
    }, perQueryTimeoutMs)
  }
})
