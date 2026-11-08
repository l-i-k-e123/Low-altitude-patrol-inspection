/**
 * cesiumCompat.js — Cesium 引擎统一入口
 *
 * Cesium 通过 index.html 的 <script src="/cesium/Cesium.js"> 注入为全局 `window.Cesium`，
 * 本模块把它包装成 ES Module 默认导出，供业务代码 `import Cesium from '@/utils/cesiumCompat'`。
 *
 * 为什么不用 `import * as Cesium from 'cesium'`：
 *   - 项目需要 Cesium 在 Vue 挂载前就绪（Worker / Assets 路径由 CESIUM_BASE_URL 决定），
 *     全局脚本加载顺序更可控；
 *   - 避免与 Vite 打包的 ESM 版本产生第二份实例（双实例会导致 WebGL 上下文与
 *     Resource 缓存互相不通）。
 */

/** 取出全局引擎；未就绪时抛出可读错误 */
function getEngine() {
  if (typeof window === 'undefined') {
    throw new Error('Cesium 仅在浏览器环境可用')
  }
  const engine = window.Cesium
  if (!engine?.Viewer) {
    throw new Error(
      'Cesium 未加载，请检查 index.html 中 /cesium/Cesium.js 是否在 main.js 之前引入',
    )
  }
  return engine
}

/**
 * 透传引擎属性。注意不能对构造函数 / 静态类做 bind，
 * 否则 Cesium.Color.fromCssColorString 之类的静态方法会丢失 this。
 */
const Cesium = new Proxy(
  {},
  {
    get(_target, prop) {
      return getEngine()[prop]
    },
  },
)

export default Cesium
export { Cesium }

/**
 * 世界坐标 → 屏幕坐标。
 * 不同 Cesium 版本该方法位置有差异，这里做一次兼容收敛。
 * @returns {object|null} Cartesian2
 */
export function worldToScreenCoordinates(scene, cartesian) {
  if (!scene || !cartesian) return null
  const engine = getEngine()
  const ST = engine.SceneTransforms
  if (typeof ST?.worldToWindowCoordinates === 'function') {
    return ST.worldToWindowCoordinates(scene, cartesian)
  }
  if (typeof ST?.wgs84ToWindowCoordinates === 'function') {
    return ST.wgs84ToWindowCoordinates(scene, cartesian)
  }
  if (typeof scene.cartesianToCanvasCoordinates === 'function') {
    return scene.cartesianToCanvasCoordinates(cartesian)
  }
  return null
}

/** 运行时检测 Cesium 是否就绪 */
export function isCesiumReady() {
  try {
    getEngine()
    return true
  } catch {
    return false
  }
}
