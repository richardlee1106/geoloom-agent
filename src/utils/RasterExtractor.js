/**
 * RasterExtractor - 栅格数据值提取工具
 * 
 * 实现类似 ArcGIS "值提取至点" 的功能
 * 从 GeoTIFF 栅格数据中根据经纬度坐标提取对应像元值
 * 
 * @author TagCloud WebGIS
 */

import * as GeoTIFF from 'geotiff';

class RasterExtractor {
  constructor() {
    this.tiff = null;
    this.image = null;
    this.rasterData = null;
    this.width = 0;
    this.height = 0;
    this.bbox = null; // [minX, minY, maxX, maxY] in WGS84
    this.noDataValue = null;
    this.isLoaded = false;
  }

  /**
   * 加载 GeoTIFF 文件
   * @param {string} url - GeoTIFF 文件的 URL 路径
   * @returns {Promise<boolean>} - 加载是否成功
   */
  async load(url) {
    try {
      console.log('[RasterExtractor] 开始加载 GeoTIFF:', url);
      
      // 使用 fetch 获取文件并创建 GeoTIFF 实例
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      this.tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
      
      // 获取第一个图像（假设是单波段人口栅格）
      this.image = await this.tiff.getImage();
      
      // 获取栅格尺寸
      this.width = this.image.getWidth();
      this.height = this.image.getHeight();
      
      // 获取地理边界框 (bbox)
      // GeoTIFF 的 bbox 格式为 [minX, minY, maxX, maxY]
      this.bbox = this.image.getBoundingBox();
      
      // 获取 NoData 值（如果存在）
      const fileDirectory = this.image.getFileDirectory();
      this.noDataValue = fileDirectory.GDAL_NODATA 
        ? parseFloat(fileDirectory.GDAL_NODATA) 
        : null;
      
      // 读取栅格数据到内存（加速后续提取）
      const rasters = await this.image.readRasters();
      this.rasterData = rasters[0]; // 第一个波段
      
      this.isLoaded = true;
      
      console.log('[RasterExtractor] 加载成功!');
      console.log('  - 尺寸:', this.width, 'x', this.height);
      console.log('  - 边界框 (WGS84):', this.bbox);
      console.log('  - NoData 值:', this.noDataValue);
      console.log('  - 像元数量:', this.rasterData.length);
      
      return true;
    } catch (error) {
      console.error('[RasterExtractor] 加载失败:', error);
      this.isLoaded = false;
      return false;
    }
  }

  /**
   * 从栅格中提取指定坐标的值
   * @param {number} lon - 经度 (WGS84)
   * @param {number} lat - 纬度 (WGS84)
   * @returns {number} - 栅格值，如果在范围外或为 NoData 则返回 0
   */
  extractValue(lon, lat) {
    if (!this.isLoaded || !this.rasterData) {
      return 0;
    }

    const [minX, minY, maxX, maxY] = this.bbox;
    
    // 检查坐标是否在栅格范围内
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) {
      return 0;
    }

    // 计算像元大小
    const pixelWidth = (maxX - minX) / this.width;
    const pixelHeight = (maxY - minY) / this.height;

    // 将经纬度转换为像素坐标
    // 注意：GeoTIFF 的 Y 轴通常是从上到下的（北在上）
    const col = Math.floor((lon - minX) / pixelWidth);
    const row = Math.floor((maxY - lat) / pixelHeight); // Y 轴反向

    // 边界检查
    if (col < 0 || col >= this.width || row < 0 || row >= this.height) {
      return 0;
    }

    // 计算一维数组索引
    const index = row * this.width + col;
    const value = this.rasterData[index];

    // NoData 处理
    if (this.noDataValue !== null && value === this.noDataValue) {
      return 0;
    }

    // 处理 NaN 或无效值
    if (isNaN(value) || value === undefined || value === null) {
      return 0;
    }

    return value;
  }

  /**
   * 批量提取多个点的栅格值
   * @param {Array<{lon: number, lat: number}>} points - 坐标点数组
   * @returns {Array<number>} - 对应的栅格值数组
   */
  extractValues(points) {
    if (!this.isLoaded) {
      return points.map(() => 0);
    }
    
    return points.map(p => this.extractValue(p.lon, p.lat));
  }

  /**
   * 为 POI 数据批量添加权重
   * @param {Array} features - GeoJSON Feature 数组
   * @returns {Array} - 添加了 weight 属性的 Feature 数组
   */
  addWeightsToFeatures(features) {
    if (!this.isLoaded || !features || features.length === 0) {
      return features;
    }

    console.log('[RasterExtractor] 开始为', features.length, '个 POI 提取权重...');
    const startTime = performance.now();

    const result = features.map(feature => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) {
        return { ...feature, properties: { ...feature.properties, weight: 0 } };
      }

      const [lon, lat] = coords;
      const weight = this.extractValue(lon, lat);

      return {
        ...feature,
        properties: {
          ...feature.properties,
          weight: weight
        }
      };
    });

    const elapsed = performance.now() - startTime;
    console.log('[RasterExtractor] 权重提取完成! 耗时:', elapsed.toFixed(2), 'ms');

    // 统计信息
    const weights = result.map(f => f.properties.weight);
    const nonZeroCount = weights.filter(w => w > 0).length;
    const maxWeight = Math.max(...weights);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    console.log('  - Ȩ:', nonZeroCount);
    console.log('  - 最大权重:', maxWeight.toFixed(2));
    console.log('  - 平均权重:', avgWeight.toFixed(2));

    return result;
  }

  /**
   * 释放资源
   */
  dispose() {
    this.tiff = null;
    this.image = null;
    this.rasterData = null;
    this.isLoaded = false;
  }

  /**
   * 获取加载状态
   */
  get loaded() {
    return this.isLoaded;
  }

  /**
   * 获取栅格元数据
   */
  getMetadata() {
    if (!this.isLoaded) return null;
    return {
      width: this.width,
      height: this.height,
      bbox: this.bbox,
      noDataValue: this.noDataValue,
      pixelCount: this.width * this.height
    };
  }

  /**
   * 获取指定范围内的栅格点数据（用于热力图）
   * @param {Array<number>} bounds - [minLon, minLat, maxLon, maxLat]
   * @param {number} maxPoints - ڽ
   * @returns {Array<{lon: number, lat: number, weight: number}>} - 点数据数组
   */
  getPointsInBounds(bounds, maxPoints = 5000) {
    if (!this.isLoaded || !this.rasterData) {
      console.warn('[RasterExtractor] 栅格未加载，无法获取点数据');
      return [];
    }

    const [minLon, minLat, maxLon, maxLat] = bounds;
    const [rMinX, rMinY, rMaxX, rMaxY] = this.bbox;

    // 计算与栅格重叠的范围
    const overlapMinX = Math.max(minLon, rMinX);
    const overlapMinY = Math.max(minLat, rMinY);
    const overlapMaxX = Math.min(maxLon, rMaxX);
    const overlapMaxY = Math.min(maxLat, rMaxY);

    // 检查是否有重叠
    if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
      console.log('[RasterExtractor] 查询范围与栅格无重叠');
      return [];
    }

    // 计算像元大小
    const pixelWidth = (rMaxX - rMinX) / this.width;
    const pixelHeight = (rMaxY - rMinY) / this.height;

    // 计算重叠区域的像素范围
    const startCol = Math.max(0, Math.floor((overlapMinX - rMinX) / pixelWidth));
    const endCol = Math.min(this.width - 1, Math.floor((overlapMaxX - rMinX) / pixelWidth));
    const startRow = Math.max(0, Math.floor((rMaxY - overlapMaxY) / pixelHeight));
    const endRow = Math.min(this.height - 1, Math.floor((rMaxY - overlapMinY) / pixelHeight));

    const rangeWidth = endCol - startCol + 1;
    const rangeHeight = endRow - startRow + 1;
    const totalPixels = rangeWidth * rangeHeight;

    console.log(`[RasterExtractor] 范围内像素: ${rangeWidth}x${rangeHeight} = ${totalPixels}`);

    // 
    const sampleRate = Math.max(1, Math.ceil(Math.sqrt(totalPixels / maxPoints)));
    console.log(`[RasterExtractor] 采样步长: ${sampleRate}`);

    const points = [];
    const startTime = performance.now();

    for (let row = startRow; row <= endRow; row += sampleRate) {
      for (let col = startCol; col <= endCol; col += sampleRate) {
        const index = row * this.width + col;
        const value = this.rasterData[index];

        // 跳过 NoData 和无效值
        if (value === this.noDataValue || isNaN(value) || value <= 0) {
          continue;
        }

        // 计算像元中心的经纬度
        const lon = rMinX + (col + 0.5) * pixelWidth;
        const lat = rMaxY - (row + 0.5) * pixelHeight;

        points.push({ lon, lat, weight: value });
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[RasterExtractor] 提取完成: ${points.length} 个点, 耗时 ${elapsed.toFixed(2)}ms`);

    return points;
  }
}

// 导出单例实例，避免重复加载
export const rasterExtractor = new RasterExtractor();
export default RasterExtractor;
