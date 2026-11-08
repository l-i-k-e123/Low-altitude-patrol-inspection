/**
 * routeRenderer.js
 * 【空间分析】航线与盲区矢量渲染
 */
import { removeLayer, registerAnalysisLayer } from './layerManager'

const ROUTE_LAYER_ID = 'patrol-route-result'
const BLIND_ZONE_LAYER_ID = 'blind-zone-result'
const VIEWSHED_LAYER_ID = 'viewshed-result'

function getEngine() {
  return window.Cesium
}

export async function renderPatrolRouteGeoJson(viewer, routeGeoJson, options = {}) {
  const Cesium = getEngine()
  removeLayer(viewer, ROUTE_LAYER_ID)

  if (!routeGeoJson) return null

  const dataSource = await Cesium.GeoJsonDataSource.load(routeGeoJson, {
    clampToGround: false,
    stroke: Cesium.Color.CYAN,
    strokeWidth: 4,
    ...options,
  })
  viewer.dataSources.add(dataSource)

  const waypoints = options.waypoints || []
  for (const entity of dataSource.entities.values) {
    const idx = entity.properties?.index?.getValue?.()
    const wp = waypoints.find((w) => w.index === idx)
    if (wp?.isRisk && entity.point) {
      entity.point.color = Cesium.Color.RED
      entity.point.pixelSize = 12
    }
  }

  return { dataSource, layerId: ROUTE_LAYER_ID }
}

export async function renderBlindZone(viewer, blindZoneGeoJson, options = {}) {
  const Cesium = getEngine()
  removeLayer(viewer, BLIND_ZONE_LAYER_ID)
  if (!blindZoneGeoJson) return null

  const dataSource = await Cesium.GeoJsonDataSource.load(blindZoneGeoJson, {
    fill: Cesium.Color.RED.withAlpha(0.35),
    stroke: Cesium.Color.RED,
    strokeWidth: 2,
    clampToGround: true,
    ...options,
  })
  viewer.dataSources.add(dataSource)
  registerAnalysisLayer(BLIND_ZONE_LAYER_ID, dataSource, '盲区分析结果')
  return { dataSource, layerId: BLIND_ZONE_LAYER_ID }
}

export async function renderViewshedResult(viewer, viewshedGeoJson) {
  const Cesium = getEngine()
  removeLayer(viewer, VIEWSHED_LAYER_ID)
  if (!viewshedGeoJson) return null

  const dataSource = await Cesium.GeoJsonDataSource.load(viewshedGeoJson, {
    fill: Cesium.Color.GREEN.withAlpha(0.25),
    stroke: Cesium.Color.GREEN,
    clampToGround: true,
  })
  viewer.dataSources.add(dataSource)
  return { dataSource, layerId: VIEWSHED_LAYER_ID }
}

export function exportRouteJson(route) {
  return JSON.stringify(route, null, 2)
}

export function exportBlindZoneJson(blindZoneData) {
  return JSON.stringify(blindZoneData, null, 2)
}

export function clearPatrolRouteGeoJson(viewer) {
  removeLayer(viewer, ROUTE_LAYER_ID)
}

export function clearBlindZone(viewer) {
  removeLayer(viewer, BLIND_ZONE_LAYER_ID)
}

export function clearViewshedResult(viewer) {
  removeLayer(viewer, VIEWSHED_LAYER_ID)
}

export function setAnalysisLayerVisible(viewer, layerId, visible) {
  const Cesium = getEngine()
  // layerManager registry uses analysis type - use setLayerVisible from layerManager if registered
  void viewer
  void Cesium
  void layerId
  void visible
}
