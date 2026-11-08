/**
 * vehicleHeatmapLayer.js — 危险车辆 3D 热力图图层
 *
 * 作用：加载 dangerous_vehicles.json，调用 heatmap3dCore 渲染抬升 3D 热力图，
 *       并在各车辆点位叠加风险等级颜色标记与文字标签。
 *
 * 主要导出：
 *   renderVehicleHeatmap(viewer, vehicleData) — 渲染热力图 + 标记
 *   clearVehicleHeatmap(viewer)               — 清除图层
 *   loadDangerousVehiclesJson(url)            — 拉取 JSON 数据
 *   isVehicleHeatmapActive()                  — 是否已激活
 *
 * 被谁使用：Enhanced3DMap.vue（toggleHeatmapLayer）
 */
/** 危险车辆 3D 热力图图层 */
import Cesium from '@/utils/cesiumCompat'
import { create3DHeatmap, destroy3DHeatmap } from './heatmap3dCore'

let heatmapHandle = null
let markerDataSource = null

const DEFAULT_GRADIENT = {
  0.3: 'blue',
  0.5: 'green',
  0.7: 'yellow',
  0.95: 'red',
}

function riskLevelColor(level) {
  if (level === '高危') return Cesium.Color.fromCssColorString('#ff3333')
  if (level === '中危') return Cesium.Color.fromCssColorString('#ffaa00')
  if (level === '低危') return Cesium.Color.fromCssColorString('#88cc44')
  return Cesium.Color.fromCssColorString('#00d4ff')
}

function addVehicleMarkers(viewer, vehicles) {
  markerDataSource = new Cesium.CustomDataSource('danger-vehicle-markers')
  viewer.dataSources.add(markerDataSource)

  for (const vehicle of vehicles) {
    const { lng, lat } = vehicle.position
    markerDataSource.entities.add({
      id: `danger_vehicle_${vehicle.id}`,
      position: Cesium.Cartesian3.fromDegrees(lng, lat, 5),
      point: {
        pixelSize: 8,
        color: riskLevelColor(vehicle.risk_level),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: vehicle.label || vehicle.type,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(800, 1, 8000, 0.55),
      },
    })
  }
}

export function isVehicleHeatmapActive() {
  return !!heatmapHandle
}

export async function renderVehicleHeatmap(viewer, vehicleData, options = {}) {
  if (!viewer || viewer.isDestroyed()) return null

  clearVehicleHeatmap(viewer)

  const vehicles = vehicleData?.vehicles || []
  if (vehicles.length < 2) {
    console.warn('危险车辆点位不足，无法生成 3D 热力图')
    return null
  }

  const dataPoints = vehicles.map((v) => ({
    lnglat: [v.position.lng, v.position.lat],
    value: Number(v.risk_value) || 500,
  }))

  const maxValue = Math.max(...dataPoints.map((d) => d.value), 100)

  heatmapHandle = await create3DHeatmap(viewer, {
    dataPoints,
    radius: options.radius ?? 24,
    canvasWidth: options.canvasWidth ?? 180,
    floorOffset: options.floorOffset ?? 15,
    heightScale: options.heightScale ?? 650,
    smoothPasses: options.smoothPasses ?? 2,
    maxValue,
    colorGradient: options.colorGradient ?? DEFAULT_GRADIENT,
    maxOpacity: 0.78,
    blur: 0.85,
  })

  if (!heatmapHandle) return null

  addVehicleMarkers(viewer, vehicles)
  viewer.scene.requestRender()

  return {
    heatmapState: heatmapHandle.heatmapState,
    vehicleCount: vehicles.length,
    cellCount: (options.canvasWidth ?? 180) ** 2,
  }
}

export function clearVehicleHeatmap(viewer) {
  if (heatmapHandle) {
    destroy3DHeatmap(heatmapHandle)
    heatmapHandle = null
  }
  if (viewer && !viewer.isDestroyed() && markerDataSource) {
    try {
      markerDataSource.entities.removeAll()
      viewer.dataSources.remove(markerDataSource, false)
    } catch (err) {
      console.warn('[heatmap] 清除车辆标记失败，尝试强制移除:', err?.message || err)
      try {
        viewer.dataSources.remove(markerDataSource, true)
      } catch {
        /* ignore */
      }
    }
    viewer.scene.requestRender()
  }
  markerDataSource = null
}

export async function loadDangerousVehiclesJson(url = '/geodata/dangerous_vehicles.json') {
  const res = await fetch(url)
  if (!res.ok) throw new Error('危险车辆数据加载失败')
  return res.json()
}
