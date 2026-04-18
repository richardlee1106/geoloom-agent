type CoordinatePair = [number, number]

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

export function useProjection(): {
  wgs84ToGcj02: (lon: number, lat: number) => CoordinatePair
  gcj02ToWgs84: (lon: number, lat: number) => CoordinatePair
  toGcj02IfNeeded: (lon: number, lat: number, coordSys?: unknown) => CoordinatePair
} {
  function wgs84ToGcj02(lon: number, lat: number): CoordinatePair {
    if (outOfChina(lon, lat)) return [lon, lat]
    const dlat = transformLat(lon - 105.0, lat - 35.0)
    const dlon = transformLon(lon - 105.0, lat - 35.0)
    const radlat = lat / 180.0 * Math.PI
    let magic = Math.sin(radlat)
    magic = 1 - EE * magic * magic
    const sqrtMagic = Math.sqrt(magic)
    const dLat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * Math.PI)
    const dLon = (dlon * 180.0) / (A / sqrtMagic * Math.cos(radlat) * Math.PI)
    const mgLat = lat + dLat
    const mgLon = lon + dLon
    return [mgLon, mgLat]
  }

  // GCJ02 → WGS84 反向迭代（3 次收敛到厘米级）。
  // 用途：高德 GCJ02 底图得到的经纬度要发给后端前必须转 WGS84，否则在武汉
  // 经纬度会产生约 500m 的系统性偏移（东南向），导致后端 viewport 与真实
  // 渲染视野不一致，蓝色 boundary 画回前端后会再次经过 wgs84→gcj02 偏移。
  function gcj02ToWgs84(lon: number, lat: number): CoordinatePair {
    if (outOfChina(lon, lat)) return [lon, lat]
    let wgsLon = lon
    let wgsLat = lat
    for (let i = 0; i < 3; i++) {
      const [convLon, convLat] = wgs84ToGcj02(wgsLon, wgsLat)
      wgsLon = lon - (convLon - wgsLon)
      wgsLat = lat - (convLat - wgsLat)
    }
    return [wgsLon, wgsLat]
  }

  function toGcj02IfNeeded(lon: number, lat: number, coordSys: unknown = 'gcj02'): CoordinatePair {
    if (String(coordSys || '').trim().toLowerCase() === 'wgs84') {
      return wgs84ToGcj02(lon, lat)
    }
    return [lon, lat]
  }

  return {
    wgs84ToGcj02,
    gcj02ToWgs84,
    toGcj02IfNeeded
  }
}
