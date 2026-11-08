/**
 * routeGeometry.js — 航线规划纯几何运算（主线程编辑 & Web Worker 共用）
 */
import * as turf from '@turf/turf'

export const ROUTE_DEFAULTS = {
  FIXED_HEIGHT: 600,
  FIXED_PITCH: -90,
  MIN_INTERVAL_M: 20,
  MAX_SEGMENT_M: 5000,
  VALIDATE_BATCH_SIZE: 80,
  /** 端点距离小于此值才视为同一线路相邻段并拼接（米） */
  TRACK_CHAIN_GAP_M: 250,
  /** 近似平行双轨去重阈值（米） */
  TRACK_DEDUPE_M: 250,
}

/** 机场椭圆禁飞区（与 Enhanced3DMap addAirportNoFlyZone 一致） */
export const AIRPORT_NO_FLY_ELLIPSES = [
  { lng: 103.9483, lat: 30.5808, radiusM: 5000, label: '双流机场禁飞区' },
  { lng: 104.4433, lat: 30.2900, radiusM: 5000, label: '天府机场禁飞区' },
]

/** 机场禁飞区圆形轮廓（开放环，用于贴地 Polygon 渲染） */
export function buildAirportNoFlyPolygonRing(zone, steps = 64) {
  const radiusKm = (zone.radiusM ?? 5000) / 1000
  const circle = turf.circle([zone.lng, zone.lat], radiusKm, { steps, units: 'kilometers' })
  const closed = circle.geometry?.coordinates?.[0]
  if (!closed?.length) return []
  return closed.slice(0, -1).map(([lng, lat]) => [lng, lat])
}

const LINE_NAME_MAP = {
  '1号线': '成都地铁1号线',
  '2号线': '成都地铁2号线',
  '3号线': '成都地铁3号线',
  '4号线': '成都地铁4号线',
  '5号线': '成都地铁5号线',
  '6号线': '成都地铁6号线',
  '7号线': '成都地铁7号线',
  '8号线': '成都地铁8号线',
  '9号线': '成都地铁9号线',
  '10号线': '成都地铁10号线',
  '17号线': '成都地铁17号线',
  '18号线': '成都地铁18号线',
  '19号线': '成都地铁19号线',
}

export function normalizeSubwayLineKey(lineText) {
  if (!lineText) return ''
  const text = String(lineText)
  if (/^成都地铁\d+号线$/.test(text)) return text
  const m = text.match(/(\d+)\s*号线/)
  if (m) {
    const key = `${m[1]}号线`
    return LINE_NAME_MAP[key] || `成都地铁${m[1]}号线`
  }
  return text
}

export function distM(a, b) {
  const dx = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  const dy = (b.lat - a.lat) * 110540
  const dz = (b.height ?? 0) - (a.height ?? 0)
  return Math.hypot(dx, dy, dz)
}

export function distM2D(lng1, lat1, lng2, lat2) {
  const dx = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180)
  const dy = (lat2 - lat1) * 110540
  return Math.hypot(dx, dy)
}

function extractSegments(geometry) {
  if (!geometry) return []
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

function isValidCoord(c) {
  return Array.isArray(c) && c.length >= 2
    && Number.isFinite(c[0]) && Number.isFinite(c[1])
    && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90
}

/** 从 GeoJSON 提取全部可用地铁线路名称 */
export function listSubwayLinesFromGeojson(geojson) {
  if (!geojson?.features?.length) return []
  const names = new Set()
  for (const f of geojson.features) {
    const name = f.properties?.name || ''
    const m = name.match(/成都地铁(\d+)号线/)
    if (m) names.add(`${m[1]}号线保护区`)
  }
  return [...names].sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    return na - nb
  })
}

function coordsToPoints(coords) {
  return coords.filter(isValidCoord).map(([lng, lat]) => ({ lng, lat }))
}

function segmentPathLengthM(points) {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += distM2D(points[i - 1].lng, points[i - 1].lat, points[i].lng, points[i].lat)
  }
  return len
}

function isNearDuplicateSegment(a, b, tolM = ROUTE_DEFAULTS.TRACK_DEDUPE_M) {
  if (!a.length || !b.length) return false
  const a0 = a[0], a1 = a[a.length - 1]
  const b0 = b[0], b1 = b[b.length - 1]
  const sameDir = distM2D(a0.lng, a0.lat, b0.lng, b0.lat) < tolM
    && distM2D(a1.lng, a1.lat, b1.lng, b1.lat) < tolM
  const revDir = distM2D(a0.lng, a0.lat, b1.lng, b1.lat) < tolM
    && distM2D(a1.lng, a1.lat, b0.lng, b0.lat) < tolM
  return sameDir || revDir
}

function dedupeTrackSegments(segments, tolM = ROUTE_DEFAULTS.TRACK_DEDUPE_M) {
  const out = []
  for (const seg of segments) {
    if (seg.length < 2) continue
    const existing = out.find((s) => isNearDuplicateSegment(s, seg, tolM))
    if (existing) {
      if (segmentPathLengthM(seg) > segmentPathLengthM(existing)) {
        out[out.indexOf(existing)] = seg
      }
      continue
    }
    out.push(seg)
  }
  return out
}

function joinSegment(path, seg, mode) {
  switch (mode) {
    case 'end-start':
      return [...path, ...seg.slice(1)]
    case 'end-end':
      return [...path, ...seg.slice(0, -1).reverse()]
    case 'start-end':
      return [...seg.slice(0, -1), ...path]
    case 'start-start':
      return [...seg.slice(1).reverse(), ...path]
    default:
      return path
  }
}

/**
 * 将端点相邻的轨道段拼成连续路径（仅当端点间距 ≤ maxGapM）
 * 不相邻的段保持独立，避免跨区误连
 */
export function chainAdjacentTrackSegments(segments, maxGapM = ROUTE_DEFAULTS.TRACK_CHAIN_GAP_M) {
  let pool = segments.filter((s) => s.length >= 2)
  const paths = []

  while (pool.length) {
    pool.sort((a, b) => segmentPathLengthM(b) - segmentPathLengthM(a))
    let path = pool.shift()
    let changed = true

    while (changed) {
      changed = false
      let bestIdx = -1
      let bestMode = null
      let bestDist = maxGapM
      const ps = path[0]
      const pe = path[path.length - 1]

      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i]
        const ss = seg[0]
        const se = seg[seg.length - 1]
        const tries = [
          ['end-start', distM2D(pe.lng, pe.lat, ss.lng, ss.lat)],
          ['end-end', distM2D(pe.lng, pe.lat, se.lng, se.lat)],
          ['start-end', distM2D(ps.lng, ps.lat, se.lng, se.lat)],
          ['start-start', distM2D(ps.lng, ps.lat, ss.lng, ss.lat)],
        ]
        for (const [mode, d] of tries) {
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
            bestMode = mode
          }
        }
      }

      if (bestIdx >= 0) {
        const seg = pool.splice(bestIdx, 1)[0]
        path = joinSegment(path, seg, bestMode)
        changed = true
      }
    }
    paths.push(path)
  }

  return paths.filter((p) => p.length >= 2)
}

/** 成都地铁线路 GeoJSON 精确名称 */
const CHENGDU_SUBWAY_LINE_RE = /^成都地铁\d+号线$/

/** 从 subway1.geojson 等大文件中筛出成都 13 条地铁线路 */
export function filterChengduSubwayGeojson(geojson) {
  if (!geojson?.features?.length) {
    return { type: 'FeatureCollection', features: [] }
  }
  const features = geojson.features.filter((f) =>
    CHENGDU_SUBWAY_LINE_RE.test(String(f.properties?.name || '')))
  return { type: 'FeatureCollection', features }
}

/** 加载航线规划专用轨道数据（subway1.geojson → 仅保留成都线路） */
export async function loadChengduSubwayRouteGeojson(url = '/geodata/subway1.geojson') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载地铁轨道数据失败: ${url}`)
  const geojson = await res.json()
  return filterChengduSubwayGeojson(geojson)
}

/** 按精确线路名取出该线路的全部折线段（未合并） */
export function extractRawTrackSegments(geojson, lineText) {
  const targetName = normalizeSubwayLineKey(lineText)
  if (!geojson?.features?.length || !targetName) return []

  const raw = []
  for (const feature of geojson.features) {
    const name = feature.properties?.name || ''
    if (name !== targetName) continue
    for (const seg of extractSegments(feature.geometry)) {
      const pts = coordsToPoints(seg)
      if (pts.length >= 2) raw.push(pts)
    }
  }
  return raw
}

/** 去重双轨后拼接相邻段 → 连续轨道路径 */
export function mergeTrackPaths(rawSegments) {
  if (!rawSegments?.length) return []
  const deduped = dedupeTrackSegments(rawSegments)
  return chainAdjacentTrackSegments(deduped)
}

/**
 * 从 subway1.geojson 等数据按精确线路名提取轨道并合并为连续路径
 * @returns {{ lng: number, lat: number }[][]}
 */
export function extractTrackPaths(geojson, lineText) {
  return mergeTrackPaths(extractRawTrackSegments(geojson, lineText))
}

/** 从 GeoJSON 取最长单条轨道（巡航用） */
export function extractTrackCoords(geojson, lineText) {
  const paths = extractTrackPaths(geojson, lineText)
  if (!paths.length) return []
  return paths.reduce((best, cur) =>
    (segmentPathLengthM(cur) > segmentPathLengthM(best) ? cur : best))
}

/** 判断实体名称是否匹配所选线路 */
export function matchSubwayLineName(entityName, lineText) {
  if (!entityName || !lineText) return false
  const targetName = normalizeSubwayLineKey(lineText)
  const name = String(entityName)
  return name === targetName || name.includes(targetName)
}

/** 超长线段分段预处理 */
export function splitLongSegments(points, maxSegM = ROUTE_DEFAULTS.MAX_SEGMENT_M) {
  if (points.length < 2) return points
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]
    const cur = points[i]
    const d = distM2D(prev.lng, prev.lat, cur.lng, cur.lat)
    if (d <= maxSegM) {
      out.push(cur)
      continue
    }
    const steps = Math.ceil(d / maxSegM)
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      out.push({
        lng: prev.lng + (cur.lng - prev.lng) * t,
        lat: prev.lat + (cur.lat - prev.lat) * t,
      })
    }
  }
  return out
}

/** 沿线段等距插值生成航点（纯几何，不含空域/气象） */
export function interpolateWaypoints(trackPoints, intervalM, fixedHeight, fixedPitch) {
  if (trackPoints.length < 2 || intervalM <= 0) return []

  const segments = []
  let total = 0
  for (let i = 1; i < trackPoints.length; i++) {
    const len = distM2D(
      trackPoints[i - 1].lng, trackPoints[i - 1].lat,
      trackPoints[i].lng, trackPoints[i].lat,
    )
    if (len < 0.01) continue
    segments.push({ from: trackPoints[i - 1], to: trackPoints[i], len, startDist: total })
    total += len
  }
  if (!segments.length) return []

  const waypoints = []
  let dist = 0
  let segIdx = 0
  let segProgress = 0

  const pushAt = (d) => {
    while (segIdx < segments.length && d > segments[segIdx].startDist + segments[segIdx].len) {
      segIdx++
    }
    if (segIdx >= segments.length) segIdx = segments.length - 1
    const seg = segments[segIdx]
    const local = Math.max(0, Math.min(seg.len, d - seg.startDist))
    const t = seg.len > 0 ? local / seg.len : 0
    waypoints.push({
      lng: seg.from.lng + (seg.to.lng - seg.from.lng) * t,
      lat: seg.from.lat + (seg.to.lat - seg.from.lat) * t,
      height: fixedHeight,
      pitch: fixedPitch,
      index: waypoints.length,
    })
  }

  pushAt(0)
  dist = intervalM
  while (dist < total - 0.5) {
    pushAt(dist)
    dist += intervalM
  }
  if (total > 0.5) {
    const last = trackPoints[trackPoints.length - 1]
    const tail = waypoints[waypoints.length - 1]
    if (!tail || distM2D(tail.lng, tail.lat, last.lng, last.lat) > 1) {
      waypoints.push({
        lng: last.lng,
        lat: last.lat,
        height: fixedHeight,
        pitch: fixedPitch,
        index: waypoints.length,
      })
    }
  }
  return waypoints
}

/** 抽稀轨道点，避免超密 GeoJSON 坐标拖慢插值/网络传输 */
export function simplifyTrackPoints(track, minStepM = 30) {
  if (!track?.length) return []
  if (track.length < 2) return track
  const out = [track[0]]
  for (let i = 1; i < track.length; i++) {
    const prev = out[out.length - 1]
    const pt = track[i]
    if (distM2D(prev.lng, prev.lat, pt.lng, pt.lat) >= minStepM) {
      out.push(pt)
    }
  }
  const last = track[track.length - 1]
  const tail = out[out.length - 1]
  if (Math.abs(tail.lng - last.lng) > 1e-9 || Math.abs(tail.lat - last.lat) > 1e-9) {
    out.push(last)
  }
  return out
}

/** 按禁飞区 + 气象重新分类全部航点（分片，避免阻塞 UI） */
export async function reclassifyWaypointsByRiskAsync(
  normal,
  risk,
  noFlyZones,
  windGrid,
  rainRegions,
  thresholds,
  batchSize = ROUTE_DEFAULTS.VALIDATE_BATCH_SIZE,
) {
  const all = [...(normal || []), ...(risk || [])]
  const byIndex = new Map()
  for (const wp of all) {
    const idx = wp.index ?? byIndex.size
    if (!byIndex.has(idx)) byIndex.set(idx, wp)
  }

  const newNormal = []
  const newRisk = []
  const sorted = [...byIndex.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const { polygons } = normalizeNoFlyZones(noFlyZones)
  const preparedRings = prepareNoFlyPolyRings(polygons)
  for (let i = 0; i < sorted.length; i++) {
    const wp = sorted[i]
    const { isRisk, reasons } = evaluatePointRisk(
      wp.lng, wp.lat, noFlyZones, windGrid, rainRegions, thresholds, preparedRings,
    )
    const item = { ...wp, reasons }
    if (isRisk) newRisk.push(item)
    else newNormal.push(item)
    if ((i + 1) % batchSize === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return {
    waypoints: newNormal,
    riskWaypoints: newRisk,
    hasRisk: newRisk.length > 0,
  }
}

/** 规范化禁飞多边形坐标环（开放环，不含重复闭合点） */
export function normalizeNoFlyRing(raw) {
  if (!raw?.length) return []
  const ring = raw.map((p) => [Number(p[0]), Number(p[1])]).filter(
    (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]),
  )
  if (ring.length > 1) {
    const [f0, f1] = ring[0]
    const [l0, l1] = ring[ring.length - 1]
    if (Math.abs(f0 - l0) < 1e-8 && Math.abs(f1 - l1) < 1e-8) {
      ring.pop()
    }
  }
  return ring.length >= 3 ? ring : []
}

/** Turf v7 要求首尾闭合，生成闭合环 */
export function toClosedRing(ring) {
  const open = normalizeNoFlyRing(ring)
  if (open.length < 3) return null
  return [...open, [open[0][0], open[0][1]]]
}

/** 全局手绘禁飞区注册表（跨组件/Worker 主线程共享） */
export const handDrawnNoFlyPolygons = []

export function registerHandDrawnNoFlyPolygon(raw) {
  const ring = normalizeNoFlyRing(raw)
  if (ring.length < 3) return null
  handDrawnNoFlyPolygons.push(ring)
  return ring
}

export function getHandDrawnNoFlyPolygons() {
  return handDrawnNoFlyPolygons.map((r) => r.map((p) => [p[0], p[1]]))
}

export function clearHandDrawnNoFlyPolygons() {
  handDrawnNoFlyPolygons.length = 0
}

/** Turf 点多边形判定（Turf v7 必须闭合环） */
export function pointInPolygon(lng, lat, polygon) {
  const open = normalizeNoFlyRing(polygon)
  if (open.length < 3) return false

  if (rayCastInPolygon(lng, lat, open)) return true

  const pt = turf.point([lng, lat])
  const variants = [open, open.slice().reverse()]
  for (const variant of variants) {
    const closed = toClosedRing(variant)
    if (!closed) continue
    try {
      const poly = turf.polygon([closed])
      if (turf.booleanPointInPolygon(pt, poly)) return true
    } catch {
      /* try next winding */
    }
  }

  return false
}

function rayCastInPolygon(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-14) + xi)) {
      inside = !inside
    }
  }
  return inside
}

/** 统一禁飞区配置 { polygons, ellipses } */
export function normalizeNoFlyZones(input) {
  if (Array.isArray(input)) {
    return { polygons: input, ellipses: [...AIRPORT_NO_FLY_ELLIPSES] }
  }
  return {
    polygons: input?.polygons || [],
    ellipses: input?.ellipses?.length ? input.ellipses : [...AIRPORT_NO_FLY_ELLIPSES],
  }
}

export function isPointInEllipse(lng, lat, ellipse) {
  if (!ellipse) return false
  return distM2D(lng, lat, ellipse.lng, ellipse.lat) <= (ellipse.radiusM ?? 5000)
}

function prepareNoFlyPolyRings(polygons) {
  return (polygons || [])
    .map((poly) => normalizeNoFlyRing(poly))
    .filter((ring) => ring.length >= 3)
}

/** 获取禁飞违规原因列表 */
export function getNoFlyViolationReasons(lng, lat, noFlyZones, preparedRings) {
  const { polygons, ellipses } = normalizeNoFlyZones(noFlyZones)
  const rings = preparedRings || prepareNoFlyPolyRings(polygons)
  const reasons = []
  for (const e of ellipses) {
    if (isPointInEllipse(lng, lat, e)) {
      reasons.push(e.label || '机场禁飞区')
    }
  }
  for (const ring of rings) {
    if (rayCastInPolygon(lng, lat, ring)) {
      reasons.push('禁飞区')
      break
    }
  }
  return reasons
}

export function isPointInNoFlyZones(lng, lat, noFlyZones) {
  return getNoFlyViolationReasons(lng, lat, noFlyZones).length > 0
}

/**
 * 按禁飞区 + 气象重新分类全部航点
 */
export function reclassifyWaypointsByRisk(normal, risk, noFlyZones, windGrid, rainRegions, thresholds) {
  const all = [...(normal || []), ...(risk || [])]
  const byIndex = new Map()
  for (const wp of all) {
    const idx = wp.index ?? byIndex.size
    if (!byIndex.has(idx)) byIndex.set(idx, wp)
  }

  const newNormal = []
  const newRisk = []
  const { polygons } = normalizeNoFlyZones(noFlyZones)
  const preparedRings = prepareNoFlyPolyRings(polygons)
  for (const wp of [...byIndex.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const { isRisk, reasons } = evaluatePointRisk(
      wp.lng, wp.lat, noFlyZones, windGrid, rainRegions, thresholds, preparedRings,
    )
    const item = { ...wp, reasons }
    if (isRisk) newRisk.push(item)
    else newNormal.push(item)
  }

  return {
    waypoints: newNormal,
    riskWaypoints: newRisk,
    hasRisk: newRisk.length > 0,
  }
}

/** @deprecated 使用 reclassifyWaypointsByRisk */
export function applyNoFlyZoneToRoute(normal, risk, noFlyPolygons) {
  return reclassifyWaypointsByRisk(normal, risk, { polygons: noFlyPolygons || [] }, null, [], {})
}

/** 风场网格采样（speeds 一维数组，行优先） */
export function sampleWindSpeed(lng, lat, grid) {
  if (!grid?.speeds?.length) return 0
  const { lo1, la1, lo2, la2, nx, ny } = grid
  if (lng < lo1 || lng > lo2 || lat < la2 || lat > la1) return 0
  const fx = ((lng - lo1) / (lo2 - lo1)) * (nx - 1)
  const fy = ((la1 - lat) / (la1 - la2)) * (ny - 1)
  const ix = Math.max(0, Math.min(nx - 1, Math.round(fx)))
  const iy = Math.max(0, Math.min(ny - 1, Math.round(fy)))
  return grid.speeds[iy * nx + ix] ?? 0
}

export function pointInRainRegion(lng, lat, regions) {
  if (!regions?.length) return { inRain: false, intensity: 0 }
  for (const r of regions) {
    if (lng >= r.min_lng && lng <= r.max_lng && lat >= r.min_lat && lat <= r.max_lat) {
      return {
        inRain: true,
        intensity: r.intensity ?? 0.5,
        weather_text: r.weather_text || '降雨区域',
      }
    }
  }
  return { inRain: false, intensity: 0 }
}

/** 根据阈值判定单点风险（禁飞区 / 降雨区 / 大风区均标红） */
export function evaluatePointRisk(lng, lat, noFlyZones, windGrid, rainRegions, thresholds, preparedRings) {
  const reasons = [...getNoFlyViolationReasons(lng, lat, noFlyZones, preparedRings)]
  const wind = sampleWindSpeed(lng, lat, windGrid)
  const windDanger = thresholds?.windDangerKmh ?? 36
  const windCaution = thresholds?.windCautionKmh ?? 25
  if (wind >= windDanger) {
    reasons.push(`大风 ${wind.toFixed(1)}km/h`)
  } else if (wind >= windCaution) {
    reasons.push(`风力偏高 ${wind.toFixed(1)}km/h`)
  }
  const rain = pointInRainRegion(lng, lat, rainRegions)
  if (rain.inRain) {
    reasons.push(rain.weather_text || '降雨区域')
  }
  return { isRisk: reasons.length > 0, reasons }
}

/** 批量校验航点风险（分片） */
export function validateWaypointsBatch(waypoints, noFlyZones, windGrid, rainRegions, thresholds, batchSize = ROUTE_DEFAULTS.VALIDATE_BATCH_SIZE) {
  const normal = []
  const risk = []
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]
    const { isRisk, reasons } = evaluatePointRisk(wp.lng, wp.lat, noFlyZones, windGrid, rainRegions, thresholds)
    const item = { ...wp, index: i, reasons }
    if (isRisk) risk.push(item)
    else normal.push(item)
  }
  return { normal, risk, batchSize }
}

/** 点击位置投影到折线最近点（支持单段或多段轨道） */
export function nearestPointOnTrack(lng, lat, trackInput) {
  if (!trackInput?.length) return null
  const paths = trackInput[0]?.lng != null ? [trackInput] : trackInput

  let best = null
  let bestDist = Infinity
  for (const track of paths) {
    if (!track?.length) continue
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1]
      const b = track[i]
      const abLng = b.lng - a.lng
      const abLat = b.lat - a.lat
      const ab2 = abLng * abLng + abLat * abLat
      if (ab2 < 1e-14) continue
      let t = ((lng - a.lng) * abLng + (lat - a.lat) * abLat) / ab2
      t = Math.max(0, Math.min(1, t))
      const plng = a.lng + abLng * t
      const plat = a.lat + abLat * t
      const d = distM2D(lng, lat, plng, plat)
      if (d < bestDist) {
        bestDist = d
        best = { lng: plng, lat: plat }
      }
    }
  }
  return best
}
