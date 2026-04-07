import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch

async function loadAiTelemetry() {
  vi.resetModules()
  return import('./aiTelemetry')
}

afterEach(() => {
  globalThis.fetch = originalFetch
  localStorage.clear()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('aiTelemetry', () => {
  it('drops malformed server weight payloads instead of persisting array-like cache entries', async () => {
    vi.stubEnv('VITE_BACKEND_VERSION', 'v3')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          version: 'server-v2',
          weights: ['unexpected']
        }
      }
    })

    const telemetry = await loadAiTelemetry()
    const snapshot = await telemetry.refreshTemplateWeights({ force: true, ttlMs: 0 })

    expect(snapshot.weights).toEqual({})
    expect(localStorage.getItem('ai_template_weights_v1')).toContain('"weights":{}')
  })
})
