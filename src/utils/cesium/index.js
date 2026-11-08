/**
 * index.js — Cesium 场景模块统一出口
 *
 * 业务代码只需要 `import { ... } from '@/utils/cesium'`，
 * 不必关心具体实现文件。分层：
 *
 *   sceneInit.js          Viewer 创建 / 销毁、canvas 尺寸校正
 *   layerManager.js       图层注册表、底图、白膜 3D Tiles、地铁矢量、相机聚焦
 *   routeRenderer.js      航线 / 盲区 / 可视域结果矢量渲染
 *   routePlannerManager.js 巡检航线规划与风场插值
 *   viewshedController.js 航点可视域交互控制
 *   spatialAnalysis.js    可选的后端空间分析适配（默认走本地估算）
 */
export * from './sceneInit'
export * from './layerManager'
export * from './routeRenderer'
export * from './spatialAnalysis'
export {
  createRoutePlannerManager,
  buildWindSpeedGrid,
} from './routePlannerManager'
export {
  createViewshedManager,
  VIEWSHED_MODE,
} from './viewshedController'
