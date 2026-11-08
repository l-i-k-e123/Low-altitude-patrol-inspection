/**
 * sceneInit.js — Cesium Viewer 创建与销毁
 *
 * 统一的场景初始化入口，负责：
 *   1. 按配置挂载单层底图（避免 Cesium 默认底图叠加导致「双地图」错位）；
 *   2. 关闭与业务大屏冲突的默认 Widget（时间轴、动画、信息框等）；
 *   3. 修正高 DPI 下 canvas 像素缓冲与 CSS 尺寸不一致导致的拖拽失灵；
 *   4. 暴露调试钩子，便于在控制台排查相机 / 图层状态。
 */
import Cesium from '@/utils/cesiumCompat'
import {
  createBasemapProvider,
  attachImageryErrorLog,
  enforceSingleBasemapLayer,
  ensureBuildingGlobeDepthSettings,
  getLayerRegistry,
  installImageryRenderRecovery,
  resetSceneViewBootstrap,
  focusChengduView,
  CHENGDU_VIEW,
  hasRealTerrainProvider,
} from './layerManager'

/**
 * 创建 Viewer 并完成底图与交互初始化。
 * @param {HTMLElement} container 地图容器
 * @param {{ viewerOptions?: object }} options 透传给 Cesium.Viewer 的配置
 * @returns {Promise<{ viewer: object, scene: object, Cesium: object, resize: Function }>}
 */
export async function createCesiumViewer(container, options = {}) {
  if (!window.Cesium?.Viewer) {
    throw new Error('Cesium 未加载，请检查 index.html 中 /cesium/Cesium.js')
  }

  const basemapProvider = await createBasemapProvider()
  attachImageryErrorLog(basemapProvider, 'basemap')

  const viewer = new Cesium.Viewer(container, {
    // 大屏不需要的默认控件一律关闭，底图完全由业务代码接管
    infoBox: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    selectionIndicator: false,
    // 显式传入单层底图，避免 Viewer 自己再挂一层 Ion/Bing
    imageryProvider: basemapProvider,
    ...options.viewerOptions,
  })

  const scene = viewer.scene

  installImageryRenderRecovery(viewer)
  viewer.useDefaultRenderLoop = true
  scene.globe.show = true
  ensureBuildingGlobeDepthSettings(viewer)

  // 开启对数深度缓冲：白膜 + 无人机模型 + 贴地矢量共存时避免 z-fighting
  scene.logarithmicDepthBuffer = true

  if (scene.screenSpaceCameraController) {
    scene.screenSpaceCameraController.enableCollisionDetection = false
  }

  // 隐藏版权容器，错误面板交由业务提示
  if (viewer.cesiumWidget?.creditContainer) {
    viewer.cesiumWidget.creditContainer.style.display = 'none'
  }
  viewer.cesiumWidget.showErrorPanel = false

  const layerCount = enforceSingleBasemapLayer(viewer)
  const layer = viewer.imageryLayers.length > 0 ? viewer.imageryLayers.get(0) : null

  const ctrl = scene.screenSpaceCameraController
  if (ctrl) {
    ctrl.enableInputs = true
    ctrl.enableRotate = true
    ctrl.enableTranslate = true
    ctrl.enableZoom = true
    ctrl.enableTilt = true
    ctrl.enableLook = true
  }

  if (layer) {
    layer.show = true
    layer.alpha = 1
  }

  getLayerRegistry().set('base-imagery', {
    type: 'imagery',
    layer,
    name: '底图影像',
    show: true,
  })

  focusChengduView(viewer, CHENGDU_VIEW.height)
  viewer.resize()
  scene.requestRender()

  const doResize = () => {
    if (viewer.isDestroyed?.()) return
    syncViewerCanvasSize(viewer)
  }
  requestAnimationFrame(doResize)
  setTimeout(doResize, 200)

  exposeViewerForDebug(viewer)

  console.info(
    '[sceneInit] 底图就绪, imageryLayers =', layerCount || viewer.imageryLayers.length,
    'provider =', basemapProvider?.constructor?.name,
  )
  return { viewer, scene, Cesium, resize: doResize }
}

/**
 * 校正 canvas 像素缓冲与 CSS 尺寸。
 * 高 DPI 屏幕下两者不一致会让鼠标拾取偏移、拖拽失效。
 */
export function syncViewerCanvasSize(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return
  viewer.resolutionScale = 1
  viewer.useDefaultRenderLoop = true
  const scene = viewer.scene
  if (scene) {
    scene.requestRenderMode = false
  }
  viewer.resize()

  const canvas = scene?.canvas
  const container = viewer.container
  if (!canvas || !container) return

  const dpr = window.devicePixelRatio || 1
  const w = container.clientWidth
  const h = container.clientHeight
  if (w <= 0 || h <= 0) return

  const expectedW = Math.floor(w * dpr)
  const expectedH = Math.floor(h * dpr)
  if (Math.abs(canvas.width - expectedW) > 2 || Math.abs(canvas.height - expectedH) > 2) {
    canvas.width = expectedW
    canvas.height = expectedH
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    scene.requestRender()
  }
}

/**
 * 暴露调试钩子到控制台：
 *   window.__mapViewer          当前 Viewer
 *   window.__mapDebug()         打印相机 / 图层 / canvas 状态
 *   window.__mapFlyChengdu()    飞回成都视野
 */
export function exposeViewerForDebug(viewer) {
  if (!viewer || typeof window === 'undefined') return
  window.__mapViewer = viewer

  window.__mapDebug = () => {
    if (viewer.isDestroyed?.()) return { error: 'viewer 已销毁' }
    const canvas = viewer.scene.canvas
    const ctrl = viewer.scene.screenSpaceCameraController
    const layers = []
    for (let i = 0; i < viewer.imageryLayers.length; i++) {
      const l = viewer.imageryLayers.get(i)
      const p = l.imageryProvider
      layers.push({
        index: i,
        show: l.show,
        alpha: l.alpha,
        providerType: p?.constructor?.name ?? 'unknown',
        ready: Boolean(p?.ready),
        url: String(p?.url ?? p?._resource?.url ?? '').slice(0, 120),
      })
    }
    const carto = viewer.camera.positionCartographic
    return {
      imageryLayers: viewer.imageryLayers.length,
      layers,
      globeShow: viewer.scene.globe?.show,
      globeTilesLoaded: viewer.scene.globe?.tilesLoaded,
      depthTestAgainstTerrain: viewer.scene.globe?.depthTestAgainstTerrain,
      hasRealTerrain: hasRealTerrainProvider(viewer),
      enableInputs: ctrl?.enableInputs,
      renderLoop: viewer.useDefaultRenderLoop,
      resolutionScale: viewer.resolutionScale,
      sceneMode: viewer.scene.mode,
      fov: viewer.camera.frustum?.fov,
      camera: carto
        ? `${Cesium.Math.toDegrees(carto.longitude).toFixed(4)}, `
          + `${Cesium.Math.toDegrees(carto.latitude).toFixed(4)}, `
          + `${Math.round(carto.height)}m`
        : 'n/a',
      canvas: `${canvas?.width}x${canvas?.height}`,
      canvasClient: canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : 'n/a',
    }
  }

  window.__mapFlyChengdu = () => {
    focusChengduView(viewer, 3500)
    return window.__mapDebug()
  }
}

/** 销毁 Viewer，重置注册表 */
export function destroyCesiumViewer(viewer) {
  resetSceneViewBootstrap()
  viewer?.destroy?.()
}
