import { API_BASE } from '@/config'

export async function fetchCityWeather() {
  const res = await fetch(`${API_BASE}/api/weather/city`)
  const json = await res.json()
  if (!json.success) throw new Error(json.message || '获取城市天气失败')
  return json.data
}

export async function fetchPatrolWeather() {
  const res = await fetch(`${API_BASE}/api/weather/patrol`)
  const json = await res.json()
  if (!json.success) throw new Error(json.message || '获取巡航线路天气失败')
  return json.data
}

export async function fetchWindField(force = false) {
  const params = force ? '?force=1' : ''
  const res = await fetch(`${API_BASE}/api/weather/wind-field${params}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.message || '获取风场数据失败')
  return json.data
}

export async function fetchRainRegions(force = false) {
  const params = force ? '?force=1' : ''
  const res = await fetch(`${API_BASE}/api/weather/rain-regions${params}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.message || '获取降雨区域失败')
  return json.data
}

export const RISK_COLORS = {
  safe: '#00ff88',
  caution: '#ffaa00',
  danger: '#ff4444',
}

export const RISK_LABELS = {
  safe: '适宜飞行',
  caution: '谨慎飞行',
  danger: '禁止飞行',
}
