/**
 * tiandituImagery.js — Cesium 官方 TiandituImageryProvider（天地图在线 WMTS）
 */
import Cesium from '@/utils/cesiumCompat'

function getEngine() {
  return window.Cesium || Cesium
}

function getTiandituToken() {
  return import.meta.env.VITE_TIANDITU_TOKEN || ''
}

export function applyCesiumRequestThrottle(engine) {
  const lib = engine || getEngine()
  if (!lib?.RequestScheduler || lib.__requestThrottleApplied) return
  lib.__requestThrottleApplied = true
  // 过严 throttle 会导致首屏瓦片永远加载不完
  lib.RequestScheduler.throttleRequests = true
  lib.RequestScheduler.maximumRequests = 30
  lib.RequestScheduler.maximumRequestsPerServer = 12
}

/** 探测天地图 token 是否可用（403 时 Cesium 会显示空球） */
export async function probeTiandituToken(token) {
  const tk = token || getTiandituToken()
  if (!tk) return false
  const url = `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=12&TILEROW=1680&TILECOL=3227&tk=${tk}`
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.status === 429) {
      console.warn('[tianditu] token 被限流 HTTP 429，将改用 ArcGIS 应急底图')
      return false
    }
    if (!res.ok) {
      console.warn(`[tianditu] token 探测失败 HTTP ${res.status}，请更新 VITE_TIANDITU_TOKEN`)
      return false
    }
    return true
  } catch (err) {
    console.warn('[tianditu] token 探测异常:', err?.message || err)
    return false
  }
}

function applyDiscardPolicy(engine, provider) {
  try {
    if (engine?.NeverTileDiscardPolicy) {
      provider.tileDiscardPolicy = new engine.NeverTileDiscardPolicy()
    }
  } catch {
    /* ignore */
  }
}

function logProviderErrorOnce(provider, label) {
  let logged = 0
  provider.errorEvent?.addEventListener?.((err) => {
    logged += 1
    if (logged <= 5) {
      console.warn(`[tianditu/${label}] 瓦片失败(${logged}/5):`, err?.message || err)
    }
  })
}

/**
 * Cesium 官方天地图影像
 * @see Cesium-iclient3d-for-cesium-2026/examples/webgl/tianditu.html
 */
export function createTiandituImageryProvider(options = {}) {
  const Cesium = getEngine()
  const token = options.token || getTiandituToken()
  if (!token) {
    throw new Error('未配置天地图 token，请在 .env 设置 VITE_TIANDITU_TOKEN')
  }

  const mapStyle = options.mapStyle
    ?? Cesium.TiandituMapsStyle?.IMG_W
    ?? Cesium.TiandituMapsStyle?.IMG_C

  const providerOptions = { token, mapStyle }
  if (Cesium.Credit) {
    providerOptions.credit = new Cesium.Credit(
      '天地图全球影像服务 · 国家地理信息公共服务平台',
    )
  }

  const provider = new Cesium.TiandituImageryProvider(providerOptions)
  applyCesiumRequestThrottle(Cesium)
  applyDiscardPolicy(Cesium, provider)
  logProviderErrorOnce(provider, 'TiandituImageryProvider')

  if (import.meta.env.DEV) {
    console.info('[tianditu] Cesium TiandituImageryProvider, mapStyle=', mapStyle)
  }
  return provider
}

export async function addTiandituBaseLayer(viewer, options = {}) {
  applyCesiumRequestThrottle(getEngine())
  const provider = createTiandituImageryProvider(options)
  if (provider.readyPromise) await provider.readyPromise
  return viewer.imageryLayers.addImageryProvider(provider)
}
