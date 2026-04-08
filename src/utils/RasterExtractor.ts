import * as GeoTIFF from 'geotiff'

type BoundingBox = [number, number, number, number]

type RasterBand = ArrayLike<number>

interface GeoTiffImageLike {
  getWidth: () => number
  getHeight: () => number
  getBoundingBox: () => number[]
  getFileDirectory: () => {
    GDAL_NODATA?: string
    [key: string]: unknown
  }
  readRasters: () => Promise<ArrayLike<RasterBand>>
}

interface GeoTiffLike {
  getImage: () => Promise<GeoTiffImageLike>
}

type PointLike = {
  lon: number
  lat: number
}

type FeatureLike = {
  geometry?: {
    coordinates?: unknown
    [key: string]: unknown
  } | null
  properties?: Record<string, unknown> | null
  [key: string]: unknown
}

class RasterExtractor {
  public tiff: GeoTiffLike | null = null
  public image: GeoTiffImageLike | null = null
  public rasterData: RasterBand | null = null
  public width = 0
  public height = 0
  public bbox: BoundingBox | null = null
  public noDataValue: number | null = null
  public isLoaded = false

  private toBoundingBox(value: unknown): BoundingBox | null {
    if (!Array.isArray(value) || value.length < 4) {
      return null
    }

    const minX = Number(value[0])
    const minY = Number(value[1])
    const maxX = Number(value[2])
    const maxY = Number(value[3])
    if (![minX, minY, maxX, maxY].every((item) => Number.isFinite(item))) {
      return null
    }

    return [minX, minY, maxX, maxY]
  }

  async load(url: string): Promise<boolean> {
    try {
      console.log('[RasterExtractor] 开始加载 GeoTIFF:', url)

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer)
      const image = await tiff.getImage()
      this.tiff = tiff as unknown as GeoTiffLike
      this.image = image as unknown as GeoTiffImageLike

      this.width = this.image.getWidth()
      this.height = this.image.getHeight()
      this.bbox = this.toBoundingBox(this.image.getBoundingBox())
      if (!this.bbox) {
        throw new Error('Invalid raster bounding box')
      }

      const fileDirectory = this.image.getFileDirectory()
      this.noDataValue = fileDirectory.GDAL_NODATA
        ? Number.parseFloat(fileDirectory.GDAL_NODATA)
        : null

      const rasters = await this.image.readRasters()
      this.rasterData = rasters[0] ?? null

      this.isLoaded = true

      console.log('[RasterExtractor] 加载成功!')
      console.log('  - 尺寸:', this.width, 'x', this.height)
      console.log('  - 边界框 (WGS84):', this.bbox)
      console.log('  - NoData 值:', this.noDataValue)
      console.log('  - 像元数量:', this.rasterData?.length ?? 0)

      return true
    } catch (error) {
      console.error('[RasterExtractor] 加载失败:', error)
      this.isLoaded = false
      return false
    }
  }

  extractValue(lon: number, lat: number): number {
    if (!this.isLoaded || !this.rasterData || !this.bbox) {
      return 0
    }

    const [minX, minY, maxX, maxY] = this.bbox

    if (lon < minX || lon > maxX || lat < minY || lat > maxY) {
      return 0
    }

    const pixelWidth = (maxX - minX) / this.width
    const pixelHeight = (maxY - minY) / this.height
    if (!Number.isFinite(pixelWidth) || pixelWidth <= 0 || !Number.isFinite(pixelHeight) || pixelHeight <= 0) {
      return 0
    }

    const col = Math.min(this.width - 1, Math.floor((lon - minX) / pixelWidth))
    const row = Math.min(this.height - 1, Math.floor((maxY - lat) / pixelHeight))

    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0
    }

    const index = row * this.width + col
    const value = this.rasterData[index]

    if (this.noDataValue !== null && value === this.noDataValue) {
      return 0
    }

    if (Number.isNaN(value) || value === undefined || value === null) {
      return 0
    }

    return value
  }

  extractValues(points: PointLike[]): number[] {
    if (!this.isLoaded) {
      return points.map(() => 0)
    }

    return points.map((point) => this.extractValue(point.lon, point.lat))
  }

  addWeightsToFeatures<T extends FeatureLike>(features: T[]): Array<T & { properties: Record<string, unknown> }> | T[] {
    if (!this.isLoaded || !features || features.length === 0) {
      return features
    }

    console.log('[RasterExtractor] 开始为', features.length, '个 POI 提取权重...')
    const startTime = performance.now()

    const result = features.map((feature) => {
      const coords = feature.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) {
        return {
          ...feature,
          properties: {
            ...(feature.properties || {}),
            weight: 0
          }
        }
      }

      const [lon, lat] = coords
      const weight = this.extractValue(Number(lon), Number(lat))

      return {
        ...feature,
        properties: {
          ...(feature.properties || {}),
          weight
        }
      }
    })

    const elapsed = performance.now() - startTime
    console.log('[RasterExtractor] 权重提取完成! 耗时:', elapsed.toFixed(2), 'ms')

    const weights = result.map((feature) => Number(feature.properties?.weight || 0))
    const nonZeroCount = weights.filter((weight) => weight > 0).length
    const maxWeight = weights.length ? Math.max(...weights) : 0
    const avgWeight = weights.length
      ? weights.reduce((sum, weight) => sum + weight, 0) / weights.length
      : 0
    console.log('  - 非零权重点数:', nonZeroCount)
    console.log('  - 最大权重:', maxWeight.toFixed(2))
    console.log('  - 平均权重:', avgWeight.toFixed(2))

    return result
  }

  dispose(): void {
    this.tiff = null
    this.image = null
    this.rasterData = null
    this.isLoaded = false
  }

  get loaded(): boolean {
    return this.isLoaded
  }

  getMetadata(): {
    width: number
    height: number
    bbox: BoundingBox
    noDataValue: number | null
    pixelCount: number
  } | null {
    if (!this.isLoaded || !this.bbox) return null
    return {
      width: this.width,
      height: this.height,
      bbox: this.bbox,
      noDataValue: this.noDataValue,
      pixelCount: this.width * this.height
    }
  }

  getPointsInBounds(bounds: number[], maxPoints = 5000): Array<{ lon: number; lat: number; weight: number }> {
    if (!this.isLoaded || !this.rasterData || !this.bbox) {
      console.warn('[RasterExtractor] 栅格未加载，无法获取点数据')
      return []
    }

    const [minLon, minLat, maxLon, maxLat] = bounds
    const [rMinX, rMinY, rMaxX, rMaxY] = this.bbox

    const overlapMinX = Math.max(minLon, rMinX)
    const overlapMinY = Math.max(minLat, rMinY)
    const overlapMaxX = Math.min(maxLon, rMaxX)
    const overlapMaxY = Math.min(maxLat, rMaxY)

    if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
      console.log('[RasterExtractor] 查询范围与栅格无重叠')
      return []
    }

    const pixelWidth = (rMaxX - rMinX) / this.width
    const pixelHeight = (rMaxY - rMinY) / this.height

    const startCol = Math.max(0, Math.floor((overlapMinX - rMinX) / pixelWidth))
    const endCol = Math.min(this.width - 1, Math.floor((overlapMaxX - rMinX) / pixelWidth))
    const startRow = Math.max(0, Math.floor((rMaxY - overlapMaxY) / pixelHeight))
    const endRow = Math.min(this.height - 1, Math.floor((rMaxY - overlapMinY) / pixelHeight))

    const rangeWidth = endCol - startCol + 1
    const rangeHeight = endRow - startRow + 1
    const totalPixels = rangeWidth * rangeHeight

    console.log(`[RasterExtractor] 范围内像素: ${rangeWidth}x${rangeHeight} = ${totalPixels}`)

    const sampleRate = Math.max(1, Math.ceil(Math.sqrt(totalPixels / maxPoints)))
    console.log(`[RasterExtractor] 采样步长: ${sampleRate}`)

    const points: Array<{ lon: number; lat: number; weight: number }> = []
    const startTime = performance.now()

    for (let row = startRow; row <= endRow; row += sampleRate) {
      for (let col = startCol; col <= endCol; col += sampleRate) {
        const index = row * this.width + col
        const value = this.rasterData[index]

        if (value === this.noDataValue || Number.isNaN(value) || value <= 0) {
          continue
        }

        const lon = rMinX + (col + 0.5) * pixelWidth
        const lat = rMaxY - (row + 0.5) * pixelHeight

        points.push({ lon, lat, weight: value })
      }
    }

    const elapsed = performance.now() - startTime
    console.log(`[RasterExtractor] 提取完成: ${points.length} 个点, 耗时 ${elapsed.toFixed(2)}ms`)

    return points
  }
}

export const rasterExtractor = new RasterExtractor()
export default RasterExtractor
