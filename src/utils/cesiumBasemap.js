/**
 * cesiumBasemap.js — Cesium Ion / 底图模式的轻量辅助函数
 *
 * 底图 Provider 的创建统一收敛在 `utils/cesium/layerManager.js`，
 * 本模块只保留两条被业务直接依赖的能力：
 *   1. 确保 Ion.defaultServer / defaultAccessToken 正确，避免误请求 localhost/v1/assets；
 *   2. 读取当前底图模式。
 *
 * 注意：Cesium Ion Token 一律从环境变量读取，**不要在代码里硬编码**。
 */

/** Ion 官方服务地址 */
const CESIUM_ION_API = 'https://api.cesium.com/'

/** 读取环境变量中的 Ion Token */
function getIonToken() {
  return import.meta.env.VITE_CESIUM_ION_TOKEN ?? ''
}

/** 当前底图模式（与 config/cesium.js 的 BASEMAP_MODE 保持一致） */
export function getCesiumBasemapMode() {
  return String(import.meta.env.VITE_BASEMAP ?? 'gaode').toLowerCase()
}

/** 是否为 Cesium 官方底图模式 */
export function isCesiumBasemapMode() {
  const mode = getCesiumBasemapMode()
  return mode === 'cesium' || mode === 'cesium-ion' || mode === 'bing'
}

/**
 * 确保 Ion 服务地址与访问令牌可用。
 * Cesium 的分包版本可能把 Ion.defaultServer 置空，导致所有 Ion 请求打到相对路径。
 */
export function ensureCesiumIonAccessToken() {
  const engine = typeof window !== 'undefined' ? window.Cesium : null
  if (!engine?.Ion) return

  const { Ion, Resource } = engine
  try {
    const raw = String(Ion.defaultServer?.url ?? Ion.defaultServer ?? '')
    if (!raw || raw === '/' || raw.includes('localhost') || raw.startsWith('/v1')) {
      Ion.defaultServer = new Resource({ url: CESIUM_ION_API })
    }
  } catch {
    /* 部分版本 defaultServer 只读，忽略 */
  }

  const token = getIonToken()
  if (token) {
    try {
      Ion.defaultAccessToken = token
    } catch {
      /* 忽略 */
    }
  }
}
