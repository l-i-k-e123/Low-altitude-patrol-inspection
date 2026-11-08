/**
 * cesiumWindLayer.js — cesium-wind 风场图层封装
 *
 * 作用：动态加载 /libs/cesium-wind.js，将天气 API 返回的风场格点数据
 *       渲染为 Canvas 粒子流线动画，叠加在 Cesium 地图上方。
 *
 * 主要导出：
 *   initWindLayer(viewer, windFieldData) — 初始化风场图层
 *   updateWindLayer / removeWindLayer       — 更新/移除数据
 *   setWindLayerVisible(visible)            — 显示/隐藏并启停动画
 *   isWindLayerActive()                     — 是否已创建图层
 *
 * 被谁使用：Enhanced3DMap.vue（toggleWindLayer / loadWindField）
 */
/** cesium-wind 风场图层封装 */
import Cesium from '@/utils/cesiumCompat'
import { worldToScreenCoordinates } from '@/utils/cesiumCompat'

let windLayer = null
let scriptLoaded = false

/** frameRate 为帧间隔毫秒数，非 FPS；paths 越少越省性能 */
const DEFAULT_WIND_OPTIONS = {
  colorScale: [
    'rgb(72,152,200)',
    'rgb(128,205,193)',
    'rgb(198,231,181)',
    'rgb(255,238,159)',
    'rgb(250,112,52)',
    'rgb(220,24,32)',
  ],
  frameRate: 80,
  maxAge: 80,
  globalAlpha: 0.72,
  velocityScale: 1 / 38,
  paths: 220,
  lineWidth: 1.2,
}

function loadCesiumWindScript() {
  if (scriptLoaded && window.CesiumWind) {
    return Promise.resolve(window.CesiumWind)
  }
  return new Promise((resolve, reject) => {
    if (window.CesiumWind) {
      scriptLoaded = true
      resolve(window.CesiumWind)
      return
    }
    window.Cesium = Cesium
    const script = document.createElement('script')
    script.src = '/libs/cesium-wind.js'
    script.onload = () => {
      scriptLoaded = true
      resolve(window.CesiumWind)
    }
    script.onerror = () => reject(new Error('cesium-wind 脚本加载失败'))
    document.head.appendChild(script)
  })
}

function patchProjectMethod(layer, viewer) {
  layer.project = (coordinate) => {
    const position = Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1])
    let sceneCoord = worldToScreenCoordinates(viewer.scene, position)
    return sceneCoord ? [sceneCoord.x, sceneCoord.y] : [-9999, -9999]
  }
}

export async function initWindLayer(viewer, windFieldData) {
  if (!viewer || !windFieldData?.length) return null

  const CesiumWind = await loadCesiumWindScript()
  const WindLayer = CesiumWind.WindLayer || CesiumWind.default

  removeWindLayer()

  windLayer = new WindLayer(windFieldData, { windOptions: DEFAULT_WIND_OPTIONS })
  patchProjectMethod(windLayer, viewer)
  windLayer.addTo(viewer)

  return windLayer
}

export function updateWindLayer(windFieldData) {
  if (windLayer && windFieldData?.length) {
    windLayer.setData(windFieldData)
  }
}

export function removeWindLayer() {
  if (windLayer) {
    windLayer.remove()
    windLayer = null
  }
}

export function setWindLayerVisible(visible) {
  if (!windLayer) return
  if (windLayer.canvas) {
    windLayer.canvas.style.display = visible ? 'block' : 'none'
  }
  const anim = windLayer.wind
  if (anim) {
    if (visible) {
      anim.start()
    } else {
      anim.stop()
    }
  }
  windLayer.viewer?.scene?.requestRender()
}

export function isWindLayerActive() {
  return !!windLayer
}
