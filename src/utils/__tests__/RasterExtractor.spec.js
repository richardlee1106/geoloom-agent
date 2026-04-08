import { describe, expect, it } from 'vitest'

import RasterExtractor from '../RasterExtractor'

describe('RasterExtractor', () => {
  it('extracts values on the eastern and southern raster boundaries', () => {
    const extractor = new RasterExtractor()

    extractor.isLoaded = true
    extractor.width = 2
    extractor.height = 2
    extractor.bbox = [0, 0, 2, 2]
    extractor.noDataValue = null
    extractor.rasterData = [10, 20, 30, 40]

    expect(extractor.extractValue(2, 1.5)).toBe(20)
    expect(extractor.extractValue(1.5, 0)).toBe(40)
  })
})
