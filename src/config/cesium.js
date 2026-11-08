/**
 * cesium.js — 三维场景与数据源配置
 *
 * 所有可调参数集中在此处，通过 Vite 环境变量覆盖（见 .env.example）。
 * 不依赖任何后端服务，缺省值保证「克隆即可跑」的最小演示效果。
 */

/** 是否开发环境 */
const DEV = import.meta.env.DEV

/** 数字型环境变量解析，非法值回退默认 */
function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 底图模式：
 * - gaode            高德卫星影像（国内访问稳定，但为 GCJ-02 坐标系）
 * - tianditu         天地图影像（WGS84，需要 VITE_TIANDITU_TOKEN）
 * - osm              OpenStreetMap
 * - cesium-ion       Cesium Ion 在线底图（需 VITE_CESIUM_ION_TOKEN）
 * - natural-earth    离线内置低清地形贴图（无网络也能出图）
 */
export const BASEMAP_MODE = String(import.meta.env.VITE_BASEMAP ?? 'gaode').toLowerCase()

/** 三维场景配置 */
export const SCENE_CONFIG = {
  /** 底图模式 */
  BASEMAP_MODE,

  /** 天地图 key（仅 BASEMAP_MODE=tianditu 时需要） */
  TIANDITU_TOKEN: import.meta.env.VITE_TIANDITU_TOKEN ?? '',

  /** Cesium Ion 访问令牌（仅 cesium-ion / Bing 底图需要） */
  CESIUM_ION_TOKEN: import.meta.env.VITE_CESIUM_ION_TOKEN ?? '',

  /**
   * 城市建筑物白膜 3D Tiles 入口（tileset.json）。
   * 开源仓库不包含该数据集（体积过大），
   * 请自行导出倾斜摄影 / 白膜数据后指向此地址；置空则跳过白膜加载。
   */
  BUILDING_TILESET_URL: import.meta.env.VITE_BUILDING_TILESET ?? '/3dlitest2/tileset.json',

  /** 白膜屏幕空间误差，越小越精细、越吃显存 */
  BUILDING_SSE: num(import.meta.env.VITE_BUILDING_SSE, 16),

  /** 白膜显存上限（MB） */
  BUILDING_MAX_MEMORY_MB: num(import.meta.env.VITE_BUILDING_MAX_MB, 256),

  /** 底图与地铁就绪后延迟加载白膜的毫秒数，避免首屏抢占带宽 */
  BUILDING_DEFER_MS: num(import.meta.env.VITE_BUILDING_DEFER_MS, 0),

  /** 地铁线路矢量数据（GeoJSON，随仓库提供成都样例） */
  SUBWAY_GEOJSON_URL: import.meta.env.VITE_SUBWAY_GEOJSON ?? '/geodata/subway.geojson',

  /** 地铁线是否贴地绘制（true 更准但更耗性能） */
  SUBWAY_CLAMP_GROUND: import.meta.env.VITE_SUBWAY_CLAMP_GROUND === 'true',

  /** 地铁保护区缓冲半径（米） */
  PROTECTION_BUFFER_M: num(import.meta.env.VITE_PROTECTION_BUFFER_M, 30),

  /** 开发环境：高德瓦片经 Vite 同源代理转发，规避浏览器系统代理失效问题 */
  GAODE_TILE_URL: DEV
    ? '/basemap-gaode/appmaptile?style=6&x={x}&y={y}&z={z}'
    : 'https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
}

/**
 * 初始相机视角（成都地铁核心区）。
 * 经纬度均为 WGS84；若使用高德底图（GCJ-02）会有几十米系统偏移，属正常现象。
 */
export const CHENGDU_VIEW = {
  longitude: 104.066,
  latitude: 30.572,
  height: 2500,
  heading: 0,
  /** 俯仰角（弧度），负值表示俯视 */
  pitch: -Math.PI / 4,
}
