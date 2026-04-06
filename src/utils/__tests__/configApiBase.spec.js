import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrls } from '../../config.js'

describe('resolveApiBaseUrls', () => {
  it('defaults spatial API base to the active dev backend when no spatial override is set', () => {
    expect(resolveApiBaseUrls({
      VITE_DEV_API_BASE: 'http://127.0.0.1:3300'
    }, true)).toEqual({
      aiBase: 'http://127.0.0.1:3300',
      spatialBase: 'http://127.0.0.1:3300'
    })
  })

  it('allows explicit spatial override when a dedicated backend is available', () => {
    expect(resolveApiBaseUrls({
      VITE_DEV_API_BASE: 'http://127.0.0.1:3300',
      VITE_SPATIAL_DEV_API_BASE: 'http://127.0.0.1:3200'
    }, true)).toEqual({
      aiBase: 'http://127.0.0.1:3300',
      spatialBase: 'http://127.0.0.1:3200'
    })
  })
})
