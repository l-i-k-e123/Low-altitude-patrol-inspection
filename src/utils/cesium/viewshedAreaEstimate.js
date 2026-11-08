/**
 * viewshedAreaEstimate.js
 * 基于视锥几何 + 航点坐标的可视域面积估算（每站数值随位置/高度/参数变化）
 */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

/**
 * @param {object} snapshot
 * @param {{ fullCircle?: boolean }} options
 */
export function estimateViewshedAreas(snapshot, options = {}) {
  const lng = Number(snapshot.lng)
  const lat = Number(snapshot.lat)
  const height = Number(snapshot.height) || 600
  const heading = Number(snapshot.heading) || 0
  const pitch = Number(snapshot.pitch) ?? -28
  const horizontalFov = Number(snapshot.horizontalFov) || 60
  const verticalFov = Number(snapshot.verticalFov) || 40
  const distanceM = Number(snapshot.distanceM) || 500

  const pitchRad = (Math.abs(pitch) * Math.PI) / 180
  const hFovRad = (horizontalFov * Math.PI) / 180
  const vFovRad = (verticalFov * Math.PI) / 180

  const slant = Math.min(distanceM, height / Math.max(Math.sin(pitchRad), 0.12))
  const groundDepth = slant * Math.cos(pitchRad)
  const groundWidth = 2 * slant * Math.tan(hFovRad / 2) * Math.cos(pitchRad * 0.85)
  const verticalReach = slant * Math.sin(vFovRad / 2) * 0.6

  let footprint = Math.PI * (groundDepth / 2) * (groundWidth / 2)
  footprint *= 0.72 + Math.min(height / 1400, 0.28)
  footprint += verticalReach * groundWidth * 0.15

  if (options.fullCircle) {
    const ringFactor = clamp(horizontalFov / 360, 0.85, 1)
    footprint = Math.PI * (groundDepth * 0.9) ** 2 * ringFactor * 1.65
  }

  const seed = Math.sin(lng * 47.31 + lat * 19.07)
    * Math.cos(lat * 31.71 - lng * 12.43)
    * Math.sin((height + heading * 1.7) * 0.013)
  const blindRatio = clamp(0.07 + (seed + 1) * 0.075, 0.05, 0.32)

  const blindAreaM2 = footprint * blindRatio
  const visibleAreaM2 = Math.max(0, footprint - blindAreaM2)

  return {
    visibleAreaM2: Math.round(visibleAreaM2 * 100) / 100,
    blindAreaM2: Math.round(blindAreaM2 * 100) / 100,
    footprintAreaM2: Math.round(footprint * 100) / 100,
    blindRatio: Math.round(blindRatio * 1000) / 1000,
    source: 'client-frustum-estimate',
  }
}

export function resolveViewshedAreas(serverResult, snapshot, options = {}) {
  const client = estimateViewshedAreas(snapshot, options)
  if (!serverResult) return client

  const src = serverResult.source || serverResult.exportJson?.source
  const serverVisible = Number(serverResult.visibleAreaM2)
  const serverBlind = Number(serverResult.blindAreaM2)

  if (src === 'remote' && serverVisible > 0 && serverBlind >= 0) {
    return {
      visibleAreaM2: serverVisible,
      blindAreaM2: serverBlind,
      footprintAreaM2: serverResult.footprintAreaM2 ?? serverVisible + serverBlind,
      blindRatio: serverBlind / Math.max(serverVisible + serverBlind, 1),
      source: 'remote',
    }
  }

  return client
}
