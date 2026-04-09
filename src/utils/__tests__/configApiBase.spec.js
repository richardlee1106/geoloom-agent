import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrls } from '../../config'

describe('resolveApiBaseUrls', () => {
  it('prefers same-origin dev proxy when local ai/spatial backends share one localhost target', () => {
    expect(resolveApiBaseUrls({
      VITE_DEV_API_BASE: 'http://127.0.0.1:3300'
    }, true)).toEqual({
      aiBase: '',
      spatialBase: ''
    })
  })

  it('keeps explicit split dev backends when ai and spatial services are intentionally separated', () => {
    expect(resolveApiBaseUrls({
      VITE_DEV_API_BASE: 'http://127.0.0.1:3300',
      VITE_SPATIAL_DEV_API_BASE: 'http://127.0.0.1:3200'
    }, true)).toEqual({
      aiBase: 'http://127.0.0.1:3300',
      spatialBase: 'http://127.0.0.1:3200'
    })
  })

  it('keeps v4 dev requests on same-origin proxy when ai and spatial both point to the local v4 backend', () => {
    expect(resolveApiBaseUrls({
      MODE: 'v4',
      VITE_BACKEND_VERSION: 'v4',
      VITE_DEV_API_BASE: 'http://127.0.0.1:3210',
      VITE_AI_DEV_API_BASE: 'http://127.0.0.1:3210',
      VITE_SPATIAL_DEV_API_BASE: 'http://127.0.0.1:3210'
    }, true)).toEqual({
      aiBase: '',
      spatialBase: ''
    })
  })

  it('keeps explicit v4 split backends when spatial service is intentionally separated', () => {
    expect(resolveApiBaseUrls({
      MODE: 'v4',
      VITE_BACKEND_VERSION: 'v4',
      VITE_AI_DEV_API_BASE: 'http://127.0.0.1:3210',
      VITE_SPATIAL_DEV_API_BASE: 'http://127.0.0.1:3411'
    }, true)).toEqual({
      aiBase: 'http://127.0.0.1:3210',
      spatialBase: 'http://127.0.0.1:3411'
    })
  })
})
