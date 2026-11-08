/**
 * latlng.js — 经纬度坐标换算工具（可视域分析专用）
 */
import Cesium from '@/utils/cesiumCompat'

const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON_AT_EQUATOR = 111320

export function mPerDegLon(lat) {
  return M_PER_DEG_LON_AT_EQUATOR * Math.cos(Cesium.Math.toRadians(lat))
}

/** 平面距离（米） */
export function distM2D(lng1, lat1, lng2, lat2) {
  const dx = (lng2 - lng1) * mPerDegLon(lat1)
  const dy = (lat2 - lat1) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

/** 三维距离（米） */
export function distM3D(a, b) {
  const dx = (b.lng - a.lng) * mPerDegLon(a.lat)
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT
  const dz = (b.height ?? 0) - (a.height ?? 0)
  return Math.hypot(dx, dy, dz)
}

/**
 * 从起点按方位角/距离计算目标点（lng/lat）
 * @param {number} bearingDeg 方位角，0=北，顺时针
 */
export function destPoint(lng, lat, bearingDeg, distanceM) {
  const br = Cesium.Math.toRadians(bearingDeg)
  const dLat = (distanceM * Math.cos(br)) / M_PER_DEG_LAT
  const dLng = (distanceM * Math.sin(br)) / mPerDegLon(lat)
  return { lng: lng + dLng, lat: lat + dLat }
}

/** 目标点 Cartesian3（含高度） */
export function destCartesian(lng, lat, height, bearingDeg, pitchDeg, distanceM) {
  const horiz = distanceM * Math.cos(Cesium.Math.toRadians(pitchDeg))
  const dHeight = distanceM * Math.sin(Cesium.Math.toRadians(pitchDeg))
  const pt = destPoint(lng, lat, bearingDeg, horiz)
  return Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, height + dHeight)
}

/** 构建扇形多边形坐标环（lng/lat 数组） */
export function buildSectorRing(lng, lat, headingDeg, fovDeg, radiusM, segments = 16) {
  const ring = [{ lng, lat }]
  const half = fovDeg / 2
  const start = headingDeg - half
  const step = fovDeg / segments
  for (let i = 0; i <= segments; i++) {
    ring.push(destPoint(lng, lat, start + step * i, radiusM))
  }
  ring.push({ lng, lat })
  return ring
}

/** 环坐标转 Cartesian3 数组（贴地高度） */
export function ringToCartesians(ring, height = 0) {
  return ring.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, height))
}

/** 判断点是否在观测半径内 */
export function withinRadius(observer, lng, lat, radiusM) {
  return distM2D(observer.lng, observer.lat, lng, lat) <= radiusM
}

/** 多边形面积（平方米，平面近似） */
export function polygonAreaM2(ring) {
  if (!ring || ring.length < 3) return 0
  let area = 0
  const n = ring.length
  for (let i = 0; i < n - 1; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % n]
    const x1 = p1.lng * mPerDegLon(p1.lat)
    const y1 = p1.lat * M_PER_DEG_LAT
    const x2 = p2.lng * mPerDegLon(p2.lat)
    const y2 = p2.lat * M_PER_DEG_LAT
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area / 2)
}
