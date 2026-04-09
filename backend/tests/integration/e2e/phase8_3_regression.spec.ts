import { describe, expect, it } from 'vitest'

import { buildRegressionApp, parseSSE } from '../helpers/chatRegressionHarness.js'
import { phase83RegressionFixtures } from './phase8_3_regression.fixture.js'

describe('Phase 8.3 regression fixtures', () => {
  it('declares the full regression corpus including area-insight golden cases', () => {
    expect(phase83RegressionFixtures).toHaveLength(14)
  })

  for (const fixture of phase83RegressionFixtures) {
    it(`closes the loop for ${fixture.id}`, async () => {
      const app = buildRegressionApp({
        providerMode: fixture.providerMode,
      })
      await app.ready()

      const response = await app.inject({
        method: 'POST',
        url: '/api/geo/chat',
        payload: {
          messages: [{ role: 'user', content: fixture.query }],
          options: {
            requestId: `phase83_${fixture.id}`,
            ...(fixture.requestOptions || {}),
          },
        },
      })

      expect(response.statusCode).toBe(200)

      const events = parseSSE(response.body)
      const refined = events.find((item) => item.event === 'refined_result')?.data

      expect(refined.results.stats.query_type).toBe(fixture.expectedQueryType)
      expect(refined.results.evidence_view.type).toBe(fixture.expectedEvidenceType)
      const searchableOutput = [
        String(refined.answer || ''),
        JSON.stringify(refined.results.evidence_view || {}),
      ].join('\n')
      for (const keyword of fixture.expectedKeywords) {
        expect(searchableOutput).toMatch(new RegExp(keyword))
      }

      if (typeof fixture.expectedProviderReady === 'boolean') {
        expect(refined.results.stats.provider_ready).toBe(fixture.expectedProviderReady)
      }

      expect(events.at(-1)?.event).toBe('done')

      await app.close()
    })
  }
})
