/**
 * routePlannerManager.js
 * 航线规划：本地插值 + 折线 + PointPrimitive 航点（避免数百 Entity 卡死）
 */
import Cesium from '@/utils/cesiumCompat'
import {
  ROUTE_DEFAULTS,
  extractTrackPaths,
  evaluatePointRisk,
  nearestPointOnTrack,
  reclassifyWaypointsByRisk,
  reclassifyWaypointsByRiskAsync,
  interpolateWaypoints,
  simplifyTrackPoints,
} from '@/utils/routeGeometry'
import { requestPatrolRoute } from './spatialAnalysis'

const ROUTE_LAYER_NAME = 'patrol-route-layer'
const USE_SERVER_ROUTE = import.meta.env.VITE_ROUTE_USE_SERVER === 'true'
const RENDER_BATCH_SIZE = 80
const MAX_DISPLAY_WAYPOINTS = 500

function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** 从风场 API 响应提取网格速度数组 */
export function buildWindSpeedGrid(windData) {
  if (!windData?.grid || !windData?.bounds) return null
  const { lo1, la1, lo2, la2 } = windData.bounds
  const { nx, ny, dx, dy } = windData.grid

  if (windData.speeds?.length === nx * ny) {
    return { lo1, la1, lo2, la2, nx, ny, dx, dy, speeds: windData.speeds }
  }

  const records = windData.field || []
  const uRec = records.find((r) => r.parameterNumber === 2)
  const vRec = records.find((r) => r.parameterNumber === 3)
  if (!uRec?.data || !vRec?.data) return null

  const speeds = []
  for (let i = 0; i < uRec.data.length; i++) {
    speeds.push(Math.hypot(uRec.data[i], vRec.data[i]) * 3.6)
  }
  return { lo1, la1, lo2, la2, nx, ny, dx, dy, speeds }
}

export function createRoutePlannerManager(viewer, options = {}) {
  let fixedHeight = options.fixedHeight ?? ROUTE_DEFAULTS.FIXED_HEIGHT
  const fixedPitch = options.fixedPitch ?? ROUTE_DEFAULTS.FIXED_PITCH

  const routeLayer = new Cesium.CustomDataSource(ROUTE_LAYER_NAME)
  if (viewer && !viewer.isDestroyed?.()) {
    viewer.dataSources.add(routeLayer)
  }

  let visible = true
  let currentRoute = null
  let currentTrack = []
  let currentTrackPaths = []
  let currentPathRanges = []
  /** @type {Cesium.PointPrimitiveCollection | null} */
  let routePointCollection = null
  let usingEntityPoints = false

  const clearPointCollection = () => {
    if (routePointCollection && viewer && !viewer.isDestroyed?.()) {
      viewer.scene.primitives.remove(routePointCollection)
      routePointCollection = null
    }
  }

  const clearEntities = () => {
    routeLayer.entities.removeAll()
    clearPointCollection()
    usingEntityPoints = false
  }

  const drawRoutePolylines = (allPoints) => {
    if (allPoints.length < 2) return
    const positions = allPoints.map((wp) =>
      Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.height ?? fixedHeight),
    )
    routeLayer.entities.add({
      id: 'patrol-route-line-main',
      name: ROUTE_LAYER_NAME,
      polyline: {
        positions,
        width: 3,
        material: Cesium.Color.fromCssColorString('#3399ff').withAlpha(0.85),
        clampToGround: false,
      },
      show: visible,
    })
  }

  const mergeRoutePoints = (waypoints, riskWaypoints) => {
    const riskSet = new Set(riskWaypoints.map((w) => `${w.lng.toFixed(6)}_${w.lat.toFixed(6)}`))
    const merged = new Map()
    for (const wp of [...(waypoints || []), ...(riskWaypoints || [])]) {
      const key = `${wp.lng.toFixed(6)}_${wp.lat.toFixed(6)}`
      const isRisk = riskSet.has(key) || (wp.reasons?.length > 0)
      merged.set(key, { ...wp, isRisk: isRisk || wp.isRisk })
    }
    return [...merged.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  }

  const pickDisplayWaypoints = (allPoints) => {
    if (allPoints.length <= MAX_DISPLAY_WAYPOINTS) return allPoints
    const riskPoints = allPoints.filter((wp) => !!(wp.reasons?.length) || wp.isRisk)
    const normalPoints = allPoints.filter((wp) => !((wp.reasons?.length) || wp.isRisk))
    const riskKeys = new Set(riskPoints.map((wp) => `${wp.lng.toFixed(6)}_${wp.lat.toFixed(6)}`))
    const budget = Math.max(0, MAX_DISPLAY_WAYPOINTS - riskPoints.length)
    if (budget <= 0) return riskPoints
    const step = Math.max(1, Math.ceil(normalPoints.length / budget))
    const sampled = normalPoints.filter((_, i) => i % step === 0)
    const merged = [...riskPoints]
    for (const wp of sampled) {
      const key = `${wp.lng.toFixed(6)}_${wp.lat.toFixed(6)}`
      if (!riskKeys.has(key)) merged.push(wp)
    }
    return merged.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  }

  const drawPointPrimitives = async (allPoints) => {
    if (!viewer || viewer.isDestroyed?.() || !allPoints.length) return
    const displayPoints = pickDisplayWaypoints(allPoints)
    routePointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
    routePointCollection.show = visible
    for (let i = 0; i < displayPoints.length; i++) {
      const wp = displayPoints[i]
      const isRisk = !!(wp.reasons?.length) || wp.isRisk
      routePointCollection.add({
        position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.height ?? fixedHeight),
        pixelSize: isRisk ? 14 : 8,
        color: isRisk
          ? Cesium.Color.fromCssColorString('#ff2222')
          : Cesium.Color.WHITE,
        outlineColor: isRisk
          ? Cesium.Color.fromCssColorString('#ff6666')
          : Cesium.Color.fromCssColorString('#00d4ff'),
        outlineWidth: isRisk ? 3 : 2,
      })
      if (i > 0 && i % RENDER_BATCH_SIZE === 0) {
        await yieldToMain()
      }
    }
  }

  const drawEntityPoints = async (allPoints) => {
    for (let i = 0; i < allPoints.length; i += RENDER_BATCH_SIZE) {
      const batch = allPoints.slice(i, i + RENDER_BATCH_SIZE)
      for (const wp of batch) {
        const isRisk = !!(wp.reasons?.length) || wp.isRisk
        routeLayer.entities.add({
          id: `route-wp-${wp.index ?? routeLayer.entities.values.length}`,
          name: isRisk ? '风险航点' : '航点',
          position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.height ?? fixedHeight),
          point: {
            pixelSize: isRisk ? 14 : 8,
            color: isRisk ? Cesium.Color.fromCssColorString('#ff2222') : Cesium.Color.WHITE,
            outlineColor: isRisk
              ? Cesium.Color.fromCssColorString('#ff6666')
              : Cesium.Color.fromCssColorString('#00d4ff'),
            outlineWidth: isRisk ? 3 : 2,
          },
          properties: {
            routeWaypoint: true,
            isRisk,
            index: wp.index,
            reasons: wp.reasons || [],
          },
          show: visible,
        })
      }
      if (i + RENDER_BATCH_SIZE < allPoints.length) {
        await yieldToMain()
      }
    }
  }

  const renderRoute = async (waypoints, riskWaypoints = [], pathRanges = currentPathRanges, options = {}) => {
    clearEntities()
    if (!viewer) return

    const allPoints = mergeRoutePoints(waypoints, riskWaypoints)
    if (!allPoints.length) return

    const useEntities = options.useEntities === true
    usingEntityPoints = useEntities

    drawRoutePolylines(allPoints)

    if (options.showPoints === false) {
      viewer.scene.requestRender()
      return
    }

    if (useEntities) {
      await drawEntityPoints(allPoints)
    } else {
      await drawPointPrimitives(allPoints)
    }
    viewer.scene.requestRender()
  }

  const normalizeServerRoute = (serverRoute, lineText, intervalM) => {
    const waypoints = serverRoute.waypoints || []
    const riskWaypoints = serverRoute.riskWaypoints || []
    const stats = serverRoute.stats || {
      total: waypoints.length + riskWaypoints.length,
      normal: waypoints.length,
      risk: riskWaypoints.length,
    }
    return {
      ...serverRoute,
      waypoints,
      riskWaypoints,
      hasRisk: serverRoute.hasRisk ?? riskWaypoints.length > 0,
      stats,
      intervalM,
      lineText: serverRoute.lineText || serverRoute.lineName || lineText,
      updatedAt: Date.now(),
    }
  }

  const buildLocalRoute = async (simplifiedTrack, intervalM, lineText, zones, windGrid, rainRegions, weatherThresholds) => {
    const raw = interpolateWaypoints(simplifiedTrack, intervalM, fixedHeight, fixedPitch)
    if (!raw.length) {
      throw new Error(`未能在轨道上等距生成航点（间隔 ${intervalM}m）`)
    }
    const reclassified = await reclassifyWaypointsByRiskAsync(
      raw,
      [],
      zones,
      windGrid,
      rainRegions,
      weatherThresholds,
    )
    return normalizeServerRoute({
      waypoints: reclassified.waypoints,
      riskWaypoints: reclassified.riskWaypoints,
      hasRisk: reclassified.hasRisk,
      stats: {
        total: raw.length,
        normal: reclassified.waypoints.length,
        risk: reclassified.riskWaypoints.length,
        pathCount: 1,
        pathRanges: [{ pathIndex: 0, startIndex: 0, endIndex: raw.length - 1 }],
      },
    }, lineText, intervalM)
  }

  const needsWeatherReclassify = (merged, windGrid, rainRegions) => {
    if (!windGrid && !(rainRegions?.length)) return false
    const all = [...(merged.waypoints || []), ...(merged.riskWaypoints || [])]
    if (!all.length) return false
    const hasWindReason = all.some((w) => (w.reasons || []).some((r) => /风|雨/.test(String(r))))
    return !hasWindReason
  }

  return {
    getRoute() { return currentRoute },
    isVisible() { return visible },

    setVisible(v) {
      visible = v
      routeLayer.show = v
      if (routePointCollection) routePointCollection.show = v
      viewer?.scene.requestRender()
    },

    clearRoute() {
      clearEntities()
      currentRoute = null
      currentTrack = []
      currentTrackPaths = []
      currentPathRanges = []
      viewer?.scene.requestRender()
    },

    async generateRoute(params) {
      const {
        geojson,
        lineText,
        trackPaths: inputTrackPaths,
        intervalM,
        noFlyZones,
        noFlyPolygons,
        windGrid,
        rainRegions,
        weatherThresholds,
      } = params

      const zones = noFlyZones || { polygons: noFlyPolygons || [] }
      const trackPaths = inputTrackPaths?.length
        ? inputTrackPaths
        : extractTrackPaths(geojson, lineText)

      if (!trackPaths.length) {
        throw new Error(`未找到线路「${lineText}」的有效轨道坐标`)
      }

      const flatTrack = trackPaths.reduce(
        (best, cur) => (cur.length > best.length ? cur : best),
        trackPaths[0] || [],
      )
      const simplifiedTrack = simplifyTrackPoints(flatTrack)

      let merged = null

      if (USE_SERVER_ROUTE) {
        try {
          const serverResult = await requestPatrolRoute({
            lineName: lineText,
            trackPoints: simplifiedTrack,
            intervalM,
            patrolHeight: fixedHeight,
            noFlyZones: zones,
          })
          merged = normalizeServerRoute(serverResult.route, lineText, intervalM)
        } catch (err) {
          console.warn('[route] 服务端规划失败，改用本地算法:', err?.message || err)
        }
      }

      if (!merged) {
        merged = await buildLocalRoute(
          simplifiedTrack,
          intervalM,
          lineText,
          zones,
          windGrid,
          rainRegions,
          weatherThresholds,
        )
      } else if (needsWeatherReclassify(merged, windGrid, rainRegions)) {
        const reclassified = await reclassifyWaypointsByRiskAsync(
          merged.waypoints,
          merged.riskWaypoints,
          zones,
          windGrid,
          rainRegions,
          weatherThresholds,
        )
        merged = {
          ...merged,
          waypoints: reclassified.waypoints,
          riskWaypoints: reclassified.riskWaypoints,
          hasRisk: reclassified.hasRisk,
          stats: {
            ...merged.stats,
            normal: reclassified.waypoints.length,
            risk: reclassified.riskWaypoints.length,
            total: reclassified.waypoints.length + reclassified.riskWaypoints.length,
          },
        }
      }

      currentRoute = merged
      currentTrackPaths = trackPaths
      currentTrack = simplifiedTrack
      currentPathRanges = merged.stats?.pathRanges || []
      await renderRoute(merged.waypoints, merged.riskWaypoints, currentPathRanges)
      return currentRoute
    },

    revalidateAllRisks({ noFlyZones, noFlyPolygons, windGrid, rainRegions, weatherThresholds }) {
      if (!currentRoute) return null
      const zones = noFlyZones || { polygons: noFlyPolygons || [] }
      const reclassified = reclassifyWaypointsByRisk(
        currentRoute.waypoints,
        currentRoute.riskWaypoints,
        zones,
        windGrid,
        rainRegions,
        weatherThresholds,
      )
      currentRoute = {
        ...currentRoute,
        waypoints: reclassified.waypoints,
        riskWaypoints: reclassified.riskWaypoints,
        hasRisk: reclassified.hasRisk,
        stats: {
          ...currentRoute.stats,
          normal: reclassified.waypoints.length,
          risk: reclassified.riskWaypoints.length,
        },
        updatedAt: Date.now(),
      }
      void renderRoute(
        reclassified.waypoints,
        reclassified.riskWaypoints,
        currentPathRanges,
        { useEntities: usingEntityPoints },
      )
      return currentRoute
    },

    addWaypointAt(lng, lat, noFlyZones, windGrid, rainRegions, thresholds) {
      if (!currentRoute) return null
      const wp = {
        lng, lat,
        height: fixedHeight,
        pitch: fixedPitch,
        index: currentRoute.waypoints.length + currentRoute.riskWaypoints.length,
      }
      const { isRisk, reasons } = evaluatePointRisk(lng, lat, noFlyZones, windGrid, rainRegions, thresholds)
      const item = { ...wp, reasons }
      if (isRisk) {
        currentRoute.riskWaypoints.push(item)
        currentRoute.hasRisk = true
      } else {
        currentRoute.waypoints.push(item)
      }
      void renderRoute(
        currentRoute.waypoints,
        currentRoute.riskWaypoints,
        currentPathRanges,
        { useEntities: usingEntityPoints },
      )
      return item
    },

    removeWaypoint(entity) {
      if (!currentRoute || !entity?.position) return false
      const pos = entity.position.getValue(Cesium.JulianDate.now())
      const carto = Cesium.Cartographic.fromCartesian(pos)
      const lng = Cesium.Math.toDegrees(carto.longitude)
      const lat = Cesium.Math.toDegrees(carto.latitude)
      const match = (w) => Math.abs(w.lng - lng) < 1e-5 && Math.abs(w.lat - lat) < 1e-5
      currentRoute.waypoints = currentRoute.waypoints.filter((w) => !match(w))
      currentRoute.riskWaypoints = currentRoute.riskWaypoints.filter((w) => !match(w))
      currentRoute.hasRisk = currentRoute.riskWaypoints.length > 0
      void renderRoute(
        currentRoute.waypoints,
        currentRoute.riskWaypoints,
        currentPathRanges,
        { useEntities: true },
      )
      return true
    },

    insertWaypointOnTrack(lng, lat, noFlyZones, windGrid, rainRegions, thresholds) {
      const nearest = nearestPointOnTrack(lng, lat, currentTrackPaths.length ? currentTrackPaths : currentTrack)
      if (!nearest) return null
      return this.addWaypointAt(nearest.lng, nearest.lat, noFlyZones, windGrid, rainRegions, thresholds)
    },

    async showRoutePoints(useEntities = true) {
      if (!currentRoute) return
      await renderRoute(
        currentRoute.waypoints,
        currentRoute.riskWaypoints,
        currentPathRanges,
        { showPoints: true, useEntities },
      )
    },

    exportJson() {
      if (!currentRoute) return null
      const all = [...currentRoute.waypoints, ...currentRoute.riskWaypoints]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      return {
        version: 1,
        line: currentRoute.lineText,
        intervalM: currentRoute.intervalM,
        fixedHeight,
        fixedPitch,
        hasRisk: currentRoute.hasRisk,
        generatedAt: new Date().toISOString(),
        waypoints: all.map((w) => ({
          lng: w.lng,
          lat: w.lat,
          height: w.height ?? fixedHeight,
          pitch: w.pitch ?? fixedPitch,
          isRisk: !!(w.reasons?.length),
          reasons: w.reasons || [],
        })),
      }
    },

    getPathPoints() {
      if (!currentRoute) return []
      return [...currentRoute.waypoints].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    },

    checkPointRisk(lng, lat, noFlyZones, windGrid, rainRegions, thresholds) {
      return evaluatePointRisk(lng, lat, noFlyZones, windGrid, rainRegions, thresholds)
    },

    setFixedHeight(h) {
      const next = Number(h)
      if (Number.isFinite(next) && next > 0) fixedHeight = next
    },

    getFixedHeight() { return fixedHeight },

    destroy() {
      clearEntities()
      if (viewer && !viewer.isDestroyed?.() && viewer.dataSources.contains(routeLayer)) {
        viewer.dataSources.remove(routeLayer, true)
      }
    },
  }
}
