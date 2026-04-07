import { describe, expect, it } from 'vitest'

import { normalizeHealthState } from './healthState'

describe('healthState', () => {
  it('normalizes dependency and provider snapshots', () => {
    const normalized = normalizeHealthState({
      version: '0.1.0',
      provider_ready: false,
      llm: {
        provider: 'openai-compatible',
        model: null,
      },
      degraded_dependencies: ['database', 'llm_provider'],
      dependencies: {
        database: {
          ready: false,
          mode: 'remote',
          degraded: true,
          reason: 'connection_failed',
        },
      },
      skills_registered: 4,
    })

    expect(normalized.version).toBe('0.1.0')
    expect(normalized.providerReady).toBe(false)
    expect(normalized.dependencies[0]).toMatchObject({
      key: 'database',
      ready: false,
      degraded: true,
      reason: 'connection_failed',
    })
    expect(normalized.degradedDependencies).toEqual(['database', 'llm_provider'])
    expect(normalized.skillsRegistered).toBe(4)
  })

  it('ignores malformed dependency containers', () => {
    const normalized = normalizeHealthState({
      dependencies: 'database-down',
      degraded_dependencies: 'database'
    })

    expect(normalized.dependencies).toEqual([])
    expect(normalized.degradedDependencies).toEqual([])
  })
})
