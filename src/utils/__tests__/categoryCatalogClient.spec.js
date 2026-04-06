import { describe, expect, it, vi } from 'vitest'

import { fetchCategoryCatalogTree } from '../categoryCatalogClient.js'

describe('fetchCategoryCatalogTree', () => {
  it('loads category tree from spatial API instead of legacy static catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return [{ value: '生活服务', label: '生活服务', children: [] }]
      }
    })

    const result = await fetchCategoryCatalogTree(fetchMock, 'http://127.0.0.1:3200')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3200/api/category/tree')
    expect(result).toEqual([{ value: '生活服务', label: '生活服务', children: [] }])
  })

  it('throws when category tree endpoint is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503
    })

    await expect(fetchCategoryCatalogTree(fetchMock, 'http://127.0.0.1:3200'))
      .rejects
      .toThrow('Failed to load category catalog (503)')
  })
})
