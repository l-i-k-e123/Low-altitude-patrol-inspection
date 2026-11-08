/**
 * detection.js — 检测接口请求（统一入参 / 异常捕获）
 */
import { API_BASE } from '@/config'

export async function startDetectionApi(options = {}) {
  const routeId = options.routeId ?? options.route_id
  const patrolMode = options.patrolMode ?? options.patrol_mode ?? 'simulation'
  const droneHeight = options.droneHeight ?? options.drone_height ?? 400
  const videoPath = options.videoPath ?? options.video_path ?? null

  if (!routeId) {
    throw new Error('缺少必填参数：航线 ID (routeId)')
  }
  if (droneHeight == null || Number.isNaN(Number(droneHeight))) {
    throw new Error('缺少必填参数：无人机高度 (droneHeight)')
  }
  if (!['patrol', 'simulation', 'demo'].includes(patrolMode)) {
    throw new Error('巡检模式 patrolMode 须为 patrol / simulation / demo')
  }

  const payload = {
    route_id: String(routeId),
    patrol_mode: patrolMode,
    drone_height: Number(droneHeight),
  }
  if (videoPath && videoPath !== '#') {
    payload.video_path = videoPath
  }

  const res = await fetch(`${API_BASE}/api/detection/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  let json = {}
  try {
    json = await res.json()
  } catch {
    json = { message: res.statusText }
  }

  if (!res.ok || json.success === false) {
    const hint = res.status === 500 || res.status === 502
      ? '（请确认 backend 已在 5000 端口启动：python backend/app.py）'
      : ''
    throw new Error((json.message || `检测启动失败 (${res.status})`) + hint)
  }

  return json
}

export async function stopDetectionApi() {
  try {
    await fetch(`${API_BASE}/api/detection/stop`, { method: 'POST' })
  } catch (err) {
    console.warn('[detection] 停止检测失败:', err)
  }
}

export function buildDetectionPayloadFromStore(store) {
  const routePlan = store.routePlan
  const routeId = routePlan?.line
    ? `${routePlan.line}-${routePlan.stats?.total ?? 0}`
    : routePlan?.lineText
      ? `${routePlan.lineText}-plan`
      : 'default-route'

  return {
    routeId,
    patrolMode: 'simulation',
    droneHeight: routePlan?.fixedHeight ?? 400,
    videoPath: null,
  }
}
