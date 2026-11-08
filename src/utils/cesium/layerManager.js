/**
 * layerManager.js — 图层注册表与三维图层加载
 *
 * 设计目标：
 *   1. 用一个「注册表」统管场景中所有图层（影像、3D Tiles、GeoJSON、自定义控制器），
 *      UI 只需要按 id 开关，不关心图层内部实现。
 *   2. 全部基于原生 Cesium API：ImageryLayer / Cesium3DTileset / GeoJsonDataSource，
 *      不依赖任何商业 GIS 服务。
 *
 * 注册表条目结构：
 *   {
 *     type: 'imagery' | 'tileset' | 'geojson' | 'custom',
 *     name: string,
 *     show: boolean,
 *     layer?: ImageryLayer,
 *     tileset?: Cesium3DTileset,
 *     dataSource?: GeoJsonDataSource,
 *     setVisible?(visible: boolean): void,
 *     getVisible?(): boolean,
 *   }
 */
import Cesium from '@/utils/cesiumCompat'
import { SCENE_CONFIG, CHENGDU_VIEW } from '@/config/cesium'

export { CHENGDU_VIEW }

// =============================================================================
// 图层注册表
// =============================================================================
const layerRegistry = new Map()

/** 缩放 / 平移时注册表自身的可见性不被覆盖，这里只记录用户意图 */
const desiredVisibility = new Map()

/** 获取图层注册表（Map 实例） */
export function getLayerRegistry() {
  return layerRegistry
}

/**
 * 注册一个自定义图层（由外部提供显隐控制器）。
 * @param {string} id 图层唯一标识
 * @param {string} name 显示名称
 * @param {{ setVisible?: Function, getVisible?: Function }} controller
 */
export function registerCustomLayer(id, name, controller = {}) {
  layerRegistry.set(id, {
    type: 'custom',
    name,
    show: controller.getVisible ? controller.getVisible() : true,
    ...controller,
  })
  return layerRegistry.get(id)
}

/** 注册一个分析结果图层（GeoJSON 数据源） */
export function registerAnalysisLayer(id, dataSource, name) {
  layerRegistry.set(id, {
    type: 'geojson',
    name: name || id,
    show: true,
    dataSource,
  })
  return layerRegistry.get(id)
}

/**
 * 设置图层显隐。
 * @returns {boolean} 是否成功找到并应用
 */
export function setLayerVisible(id, visible) {
  const entry = layerRegistry.get(id)
  if (!entry) return false
  desiredVisibility.set(id, visible)
  entry.show = visible
  applyEntryVisibility(entry, visible)
  return true
}

/** 按注册表条目类型分发显隐 */
function applyEntryVisibility(entry, visible) {
  switch (entry.type) {
    case 'imagery':
      if (entry.layer) entry.layer.show = visible
      break
    case 'tileset':
      if (entry.tileset) entry.tileset.show = visible
      break
    case 'geojson':
      if (entry.dataSource) entry.dataSource.show = visible
      break
    case 'custom':
      entry.setVisible?.(visible)
      break
    default:
      break
  }
}

/** 按 id 移除图层，并清理场景对象 */
export function removeLayer(viewer, id) {
  const entry = layerRegistry.get(id)
  if (!entry) return false
  if (viewer && !viewer.isDestroyed?.()) {
    const scene = viewer.scene
    try {
      if (entry.type === 'imagery' && entry.layer) {
        viewer.imageryLayers.remove(entry.layer, true)
      } else if (entry.type === 'tileset' && entry.tileset) {
        scene.primitives.remove(entry.tileset)
      } else if (entry.type === 'geojson' && entry.dataSource) {
        viewer.dataSources.remove(entry.dataSource, true)
      }
    } catch (err) {
      console.warn('[layerManager] 移除图层失败:', id, err?.message || err)
    }
  }
  layerRegistry.delete(id)
  desiredVisibility.delete(id)
  return true
}

/** 清空所有图层 */
export function clearAllLayers(viewer) {
  for (const id of Array.from(layerRegistry.keys())) {
    removeLayer(viewer, id)
  }
}

// =============================================================================
// 影像底图
// =============================================================================
/**
 * Cesium 打包版的 Ion.defaultServer 可能为空，导致误请求 localhost/v1/assets。
 * 这里统一指向官方地址，并在有 token 时写入。
 */
export function ensureIonServer() {
  const { Ion, Resource } = Cesium
  if (!Ion || !Resource) return
  try {
    Ion.defaultServer = new Resource({ url: 'https://api.cesium.com/' })
    if (SCENE_CONFIG.CESIUM_ION_TOKEN) {
      Ion.defaultAccessToken = SCENE_CONFIG.CESIUM_ION_TOKEN
    }
  } catch {
    /* 忽略：部分版本 Ion 为只读 */
  }
}

/** 高德卫星影像（国内稳定，GCJ-02 坐标系） */
export function createGaodeImageryProvider() {
  return new Cesium.UrlTemplateImageryProvider({
    url: SCENE_CONFIG.GAODE_TILE_URL,
    minimumLevel: 3,
    maximumLevel: 18,
    enablePickFeatures: false,
  })
}

/** OpenStreetMap 影像 */
export function createOsmImageryProvider() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
  })
}

/** Cesium 内置离线底图（Natural Earth II，随引擎分包发布） */
export function createNaturalEarthImageryProvider() {
  const url = Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
  return new Cesium.TileMapServiceImageryProvider({ url })
}

/**
 * 按配置创建底图 Provider。
 * @returns {Promise<object>} ImageryProvider
 */
export async function createBasemapProvider(mode = SCENE_CONFIG.BASEMAP_MODE) {
  const fallback = () => createGaodeImageryProvider()

  if (mode === 'osm') {
    try {
      return createOsmImageryProvider()
    } catch (err) {
      console.warn('[layerManager] OSM 底图失败，回退高德:', err?.message || err)
      return fallback()
    }
  }

  if (mode === 'natural-earth' || mode === 'cesium-natural-earth') {
    try {
      return createNaturalEarthImageryProvider()
    } catch (err) {
      console.warn('[layerManager] Natural Earth 失败，回退高德:', err?.message || err)
      return fallback()
    }
  }

  if (mode === 'tianditu') {
    try {
      const { createTiandituImageryProvider } = await import('@/utils/tiandituImagery')
      return createTiandituImageryProvider({ token: SCENE_CONFIG.TIANDITU_TOKEN })
    } catch (err) {
      console.warn('[layerManager] 天地图失败，回退高德:', err?.message || err)
      return fallback()
    }
  }

  if (mode === 'cesium-ion') {
    ensureIonServer()
    try {
      if (typeof Cesium.createWorldImagery === 'function') {
        return Cesium.createWorldImagery()
      }
      return new Cesium.IonImageryProvider({ assetId: 2 })
    } catch (err) {
      console.warn('[layerManager] Ion 底图失败，回退 Natural Earth:', err?.message || err)
      try {
        return createNaturalEarthImageryProvider()
      } catch {
        return fallback()
      }
    }
  }

  return fallback()
}

/** 兼容旧调用：创建 Viewer 时使用的初始底图 Provider */
export const createInitialImageryProvider = createBasemapProvider
export const createDefaultViewerImageryProvider = createBasemapProvider

/** 影像层错误不打断渲染，仅记录前若干次，避免栅格瓦片 404 刷屏 */
export function attachImageryErrorLog(provider, label = 'imagery') {
  if (!provider?.errorEvent?.addEventListener) return
  let logged = 0
  provider.errorEvent.addEventListener((err) => {
    if (logged >= 5) return
    logged += 1
    console.warn(`[layerManager] ${label} 瓦片加载失败(${logged}/5):`, err?.message || err)
  })
}

/**
 * 影像渲染自愈：WebGL 上下文丢失 / 缩放重建后偶发白球，
 * 这里监听相机静止事件做一次轻量校正。
 */
export function installImageryRenderRecovery(viewer) {
  if (!viewer || viewer.__imageryRecoveryInstalled) return
  viewer.__imageryRecoveryInstalled = true
  const scene = viewer.scene
  let busy = false
  viewer.camera.moveEnd.addEventListener(() => {
    if (busy) return
    busy = true
    setTimeout(() => {
      busy = false
      try {
        if (viewer.isDestroyed?.()) return
        if (scene.globe) scene.globe.show = true
        if (viewer.imageryLayers.length === 0) return
        // 参考层保活：确保第一层可见，避免全部图层被意外隐藏后出现黑球
        const base = viewer.imageryLayers.get(0)
        if (base && desiredVisibility.get('base-imagery') !== false) base.show = true
      } catch {
        /* 忽略 */
      }
    }, 0)
  })
}

/**
 * 强制只保留一层底图。
 * Cesium 默认会自带一层 Ion / Bing 底图，业务底图再挂一层就会「双地图」错位。
 * @returns {number} 保留下来的影像层数量
 */
export function enforceSingleBasemapLayer(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return 0
  const layers = viewer.imageryLayers
  while (layers.length > 1) {
    layers.remove(layers.get(1), true)
  }
  return layers.length
}

/** 重置场景引导状态（销毁 Viewer 时调用，便于 HMR / 重复挂载） */
export function resetSceneViewBootstrap() {
  layerRegistry.clear()
  desiredVisibility.clear()
}

// =============================================================================
// 地球 / 地形
// =============================================================================
/** 是否挂载了真实地形（非 EllipsoidTerrainProvider） */
export function hasRealTerrainProvider(viewer) {
  const tp = viewer?.terrainProvider
  if (!tp) return false
  return !(tp instanceof Cesium.EllipsoidTerrainProvider)
}

/**
 * 白膜与 Entity 共存的深度策略。
 * Cesium 的 depth plane 问题（#7879）会导致贴地线被白膜遮挡，
 * 这里统一关闭 depthTestAgainstTerrain，让矢量始终可见。
 */
export function ensureBuildingGlobeDepthSettings(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return
  const globe = viewer.scene.globe
  if (!globe) return
  globe.depthTestAgainstTerrain = false
}

/** 白膜加载后的一次性调优（SSE 已由 tileset 构造参数给定，这里只处理遮挡关系） */
export function tuneBuildingTilesetForOverlay(viewer, tileset) {
  if (!viewer || !tileset) return
  // 白膜贴地渲染，避免与地形互相穿插
  try {
    tileset.shadows = Cesium.ShadowMode.DISABLED
  } catch {
    /* 忽略 */
  }
}

// =============================================================================
// 城市白膜（3D Tiles）
// =============================================================================
/**
 * 加载城市建筑物白膜 3D Tiles。
 * @returns {Promise<{tileset: object|null, layers?: Array}>}
 */
export async function loadCityBuildingLayer(viewer, options = {}) {
  const url = options.url ?? SCENE_CONFIG.BUILDING_TILESET_URL
  if (!url) {
    console.info('[layerManager] 未配置白膜地址（VITE_BUILDING_TILESET），跳过白膜加载')
    return { tileset: null }
  }
  if (!viewer || viewer.isDestroyed?.()) return { tileset: null }

  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: SCENE_CONFIG.BUILDING_SSE,
      maximumMemoryUsage: SCENE_CONFIG.BUILDING_MAX_MEMORY_MB,
      skipLevelOfDetail: true,
      preferLeaves: true,
    })
    viewer.scene.primitives.add(tileset)

    layerRegistry.set('city-building', {
      type: 'tileset',
      name: '城市白膜',
      show: true,
      tileset,
      source: url,
    })
    console.info('[layerManager] 白膜 3D Tiles 就绪:', url)
    return { tileset }
  } catch (err) {
    console.warn('[layerManager] 白膜加载失败（数据可能未包含在仓库中）:', err?.message || err)
    return { tileset: null }
  }
}

// =============================================================================
// 地铁线路（GeoJSON）
// =============================================================================
/**
 * 加载地铁线路矢量。
 * @returns {Promise<{entities: Array, dataSource: object|null}>}
 * @param {{ id?: string, geoJson?: object, geojsonUrl?: string, onLoaded?: Function }} options
 */
export async function addSubwayVectorLayer(viewer, options = {}) {
  const {
    id = 'subway-lines',
    geojsonUrl = SCENE_CONFIG.SUBWAY_GEOJSON_URL,
    onLoaded,
  } = options

  if (!viewer) return { entities: [], dataSource: null }

  const existing = layerRegistry.get(id)
  if (existing?.dataSource) {
    const entities = Array.from(existing.dataSource.entities.values)
    onLoaded?.(existing.dataSource)
    return { entities, dataSource: existing.dataSource }
  }

  const dataSource = new Cesium.GeoJsonDataSource(id)
  await dataSource.load(geojsonUrl, {
    stroke: Cesium.Color.CYAN,
    strokeWidth: 4,
    fill: Cesium.Color.TRANSPARENT,
    clampToGround: SCENE_CONFIG.SUBWAY_CLAMP_GROUND,
  })
  await viewer.dataSources.add(dataSource)

  layerRegistry.set(id, {
    type: 'geojson',
    name: '地铁线路',
    show: true,
    dataSource,
  })
  const entities = Array.from(dataSource.entities.values)
  onLoaded?.(dataSource)
  return { entities, dataSource }
}

// =============================================================================
// 相机与场景聚焦
// =============================================================================
/** 相机是否在成都视野附近 */
export function isCameraNearChengdu(viewer, { maxHeight = 80000, maxDeltaDeg = 1.5 } = {}) {
  if (!viewer || viewer.isDestroyed?.()) return false
  const carto = viewer.camera.positionCartographic
  if (!carto) return false
  const lng = Cesium.Math.toDegrees(carto.longitude)
  const lat = Cesium.Math.toDegrees(carto.latitude)
  if (carto.height > maxHeight) return false
  return (
    Math.abs(lng - CHENGDU_VIEW.longitude) <= maxDeltaDeg
    && Math.abs(lat - CHENGDU_VIEW.latitude) <= maxDeltaDeg
  )
}

/** 飞到成都地铁核心区视角 */
export function focusChengduView(viewer, height = CHENGDU_VIEW.height) {
  if (!viewer || viewer.isDestroyed?.()) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      CHENGDU_VIEW.longitude,
      CHENGDU_VIEW.latitude,
      height,
    ),
    orientation: {
      heading: CHENGDU_VIEW.heading,
      pitch: CHENGDU_VIEW.pitch,
      roll: 0,
    },
    duration: 1.2,
  })
}

/** 把视角定位到白膜的包围球（自适应距离） */
export function focusViewOnBuildingTileset(viewer, tileset, height = 3500) {
  if (!tileset || !viewer) return
  const sphere = tileset.boundingSphere
  if (!sphere?.center) return
  const carto = Cesium.Cartographic.fromCartesian(sphere.center)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude),
      height,
    ),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 1.5,
  })
}

/** 加载完成后的收尾：按需飞到白膜，否则回成都视野 */
export async function finalizeSceneView(viewer, tileset, { force = false } = {}) {
  if (!viewer || viewer.isDestroyed?.()) return
  if (tileset && (force || !isCameraNearChengdu(viewer))) {
    focusViewOnBuildingTileset(viewer, tileset)
  } else if (!isCameraNearChengdu(viewer)) {
    focusChengduView(viewer)
  }
  viewer.scene.requestRender()
}

/**
 * 场景健康检查：影像层是否为空、地球是否被隐藏等常见「白球 / 黑球」问题。
 * @returns {boolean} 是否做了修复
 */
export function recoverSceneHealth(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return false
  const scene = viewer.scene
  let repaired = false
  try {
    if (scene.globe && !scene.globe.show) {
      scene.globe.show = true
      repaired = true
    }
    if (viewer.imageryLayers.length === 0) {
      const provider = createGaodeImageryProvider()
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      attachImageryErrorLog(provider, 'recovery-basemap')
      layerRegistry.set('base-imagery', {
        type: 'imagery',
        name: '底图影像',
        show: true,
        layer,
      })
      repaired = true
    }
    if (repaired) scene.requestRender()
  } catch (err) {
    console.warn('[layerManager] 场景修复失败:', err?.message || err)
  }
  return repaired
}
