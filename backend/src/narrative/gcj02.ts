/**
 * WGS-84 → GCJ-02（火星坐标系）坐标转换。
 * 适用范围：中国大陆。境外坐标原样返回。
 * 算法来源：国家标准公开推导公式（各大地图 SDK 一致）。
 */

const π = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lon: number, lat: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * π) + 20.0 * Math.sin(2.0 * x * π)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * π) + 40.0 * Math.sin((y / 3.0) * π)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * π) + 320 * Math.sin((y * π) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLon(x: number, y: number): number {
  let ret =
    300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * π) + 20.0 * Math.sin(2.0 * x * π)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * π) + 40.0 * Math.sin((x / 3.0) * π)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * π) + 300.0 * Math.sin((x / 30.0) * π)) * 2.0) / 3.0
  return ret
}

/**
 * 单点转换：WGS-84 [lon, lat] → GCJ-02 [lon, lat]。
 */
export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat]
  let dLat = transformLat(lon - 105.0, lat - 35.0)
  let dLon = transformLon(lon - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * π
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * π)
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * π)
  return [lon + dLon, lat + dLat]
}

export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lon, lat)) return [lon, lat]
  let wgsLon = lon
  let wgsLat = lat
  for (let i = 0; i < 3; i += 1) {
    const [convLon, convLat] = wgs84ToGcj02(wgsLon, wgsLat)
    wgsLon = lon - (convLon - wgsLon)
    wgsLat = lat - (convLat - wgsLat)
  }
  return [wgsLon, wgsLat]
}

type LonLat = [number, number]
type Ring = LonLat[]

/**
 * 对 Polygon coordinates[0]（外环）做 WGS-84 → GCJ-02 批量转换。
 */
export function transformRingToGcj02(ring: Ring): Ring {
  return ring.map(([lon, lat]) => wgs84ToGcj02(lon, lat))
}

/**
 * 对完整 GeoJSON Polygon coordinates（可能含多个环）做 WGS-84 → GCJ-02 转换。
 */
export function transformPolygonCoordsToGcj02(rings: Ring[]): Ring[] {
  return rings.map(transformRingToGcj02)
}
