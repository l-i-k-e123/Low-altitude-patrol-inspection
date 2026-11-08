/**
 * subwayPathUtils.js — 地铁线路路径提取工具
 *
 * 作用：从 subway1.geojson（成都地铁线路）中按线路名称提取经纬度路径，
 *       并进行抽稀简化，供无人机巡航引擎使用。
 *
 * 主要导出：
 *   normalizeSubwayLineKey(lineText) — 将简写线路名转为 GeoJSON 中的完整名称
 *   getSubwayLinePath(geojson, lineText) — 返回 { lng, lat }[] 路径点序列
 *
 * 被谁使用：Enhanced3DMap.vue、dronePatrolEngine（间接，通过 ensureDronePatrols）
 */
/** 从 subway.geojson 提取指定地铁线路路径（经纬度序列） */

import { extractTrackCoords, normalizeSubwayLineKey } from './routeGeometry.js'

export { normalizeSubwayLineKey }

function segmentLength(coords) {
  let len = 0
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * 111320 * Math.cos((coords[i][1] * Math.PI) / 180)
    const dy = (coords[i][1] - coords[i - 1][1]) * 110540
    len += Math.hypot(dx, dy)
  }
  return len
}

function extractSegments(geometry) {
  if (!geometry) return []
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

function simplifyPath(points, minStep = 40) {
  if (points.length <= 2) return points
  const out = [points[0]]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const dx = (cur.lng - prev.lng) * 111320 * Math.cos((cur.lat * Math.PI) / 180)
    const dy = (cur.lat - prev.lat) * 110540
    acc += Math.hypot(dx, dy)
    if (acc >= minStep || i === points.length - 1) {
      out.push(cur)
      acc = 0
    }
  }
  return out
}

/**
 * @param {object} geojson
 * @param {string} lineText 如 "1号线保护区" / "1号线"
 * @returns {{ lng: number, lat: number }[]}
 */
export function getSubwayLinePath(geojson, lineText) {
  const points = extractTrackCoords(geojson, lineText)
  return simplifyPath(points, 35)
}
