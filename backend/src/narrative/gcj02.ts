/**
 * WGS84 ↔ GCJ02 坐标转换（火星坐标系）。
 *
 * 使用场景：narrative 后端需要把来自 OSM 的 WGS84 数据（aois / landuse 表）
 * 与来自高德的 GCJ02 数据（pois 表）对齐到同一坐标系后再发给前端。
 *
 * 统一策略：后端所有 narrative 输出（node.center / boundary / pois.coordinates）
 * 都使用 GCJ02，前端直接 fromLonLat 即可贴合高德 GCJ02 底图，不再做二次转换。
 */

const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lon: number, lat: number): boolean {
  return (lon < 72.004 || lon > 137.8347) || (lat < 0.8293 || lat > 55.8271)
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}

export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [lon, lat]
  if (outOfChina(lon, lat)) return [lon, lat]
  const dlat = transformLat(lon - 105.0, lat - 35.0)
  const dlon = transformLon(lon - 105.0, lat - 35.0)
  const radlat = lat / 180.0 * Math.PI
  let magic = Math.sin(radlat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI)
  const dLon = (dlon * 180.0) / (A / sqrtMagic * Math.cos(radlat) * Math.PI)
  return [lon + dLon, lat + dLat]
}

/**
 * 递归对 GeoJSON Polygon / MultiPolygon 的 coordinates 做 WGS84 → GCJ02 转换。
 * 只改变数值，不改变嵌套结构。
 */
export function transformGeoJsonCoordinatesWgs84ToGcj02(
  coordinates: unknown,
): unknown {
  if (!Array.isArray(coordinates)) return coordinates
  // 判断当前层是否是 [lon, lat] 叶节点
  if (
    coordinates.length >= 2
    && typeof coordinates[0] === 'number'
    && typeof coordinates[1] === 'number'
  ) {
    const [lon, lat] = wgs84ToGcj02(coordinates[0] as number, coordinates[1] as number)
    // 保留额外维度（如 Z / M）
    return coordinates.length > 2 ? [lon, lat, ...coordinates.slice(2)] : [lon, lat]
  }
  return coordinates.map((item) => transformGeoJsonCoordinatesWgs84ToGcj02(item))
}
