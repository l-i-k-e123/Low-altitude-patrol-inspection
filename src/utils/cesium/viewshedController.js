/**
 * viewshedController.js
 * 航点悬停：多站 ViewShed3D 累积保留，图层控制统一显隐。
 */
import { requestViewshed360Analysis } from './spatialAnalysis'
import { clearBlindZone, clearViewshedResult } from './routeRenderer'
import { registerCustomLayer, setLayerVisible } from './layerManager'
import { createWaypointViewshedPool } from './waypointViewshedPool'
import { resolveViewshedAreas } from './viewshedAreaEstimate'

const MODE = {
  IDLE: 'idle',
  FLIGHT: 'flight',
  HOVER_SCAN: 'hover_scan',
  HOVER_ANALYSE: 'hover_analyse',
}

const SERVER_ANALYSIS_TIMEOUT_MS = 8000

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} 超时`)), ms)
    }),
  ])
}

export function createViewshedManager(viewer, options = {}) {
  const config = {
    maxDistanceM: options.maxDistanceM ?? 500,
    hFovDeg: options.hFovDeg ?? 60,
    vFovDeg: options.vFovDeg ?? 40,
    scanStepDeg: options.scanStepDeg ?? 10,
    pitchDeg: options.pitchDeg ?? -28,
    onStateChange: options.onStateChange ?? (() => {}),
    onScanProgress: options.onScanProgress ?? (() => {}),
    onAnalyseComplete: options.onAnalyseComplete ?? (() => {}),
    onAreaWarning: options.onAreaWarning ?? (() => {}),
    onBboxFilterWarning: options.onBboxFilterWarning ?? (() => {}),
  }

  let mode = MODE.IDLE
  let buildingsEnabled = true
  let terrainEnabled = true
  let meshPrecision = options.meshPrecision ?? 'high'
  let gimbalPitch = config.pitchDeg
  let gimbalHeading = 0
  let viewshedLayerVisible = true
  let currentObserver = null
  let currentWaypointMeta = null
  let lastExportData = null
  let scanCancelled = false
  let scanCompleteResolve = null
  let boundsDebugVisible = false
  let cumulativeVisibleM2 = 0
  let cumulativeBlindM2 = 0

  const viewshedPool = createWaypointViewshedPool(viewer?.scene, viewer, {
    distanceM: config.maxDistanceM,
    horizontalFov: config.hFovDeg,
    verticalFov: config.vFovDeg,
    pitchDeg: config.pitchDeg,
  })

  registerCustomLayer('viewshed-waypoint', '航点立体可视域', {
    getVisible: () => viewshedLayerVisible,
    setVisible: (visible) => viewshedPool.setLayerVisible(visible),
  })

  const notifyState = (extra = {}) => {
    config.onStateChange({
      mode,
      buildingsEnabled,
      terrainEnabled,
      meshPrecision,
      gimbalPitch,
      gimbalHeading,
      canExport: !!lastExportData,
      scanning: mode === MODE.HOVER_SCAN,
      analysing: mode === MODE.HOVER_ANALYSE,
      boundsDebugVisible,
      savedWaypointCount: viewshedPool.getCount(),
      ...extra,
    })
  }

  const applyLayerVisibility = () => {
    setLayerVisible('blind-zone-result', viewshedLayerVisible)
    setLayerVisible('viewshed-waypoint', viewshedLayerVisible)
  }

  const isScanCancelled = () => scanCancelled

  return {
    getMode() { return mode },
    getSavedWaypointCount() { return viewshedPool.getCount() },

    setBuildingsEnabled(enabled) {
      buildingsEnabled = !!enabled
      notifyState()
    },

    setTerrainEnabled(enabled) {
      terrainEnabled = !!enabled
      notifyState()
    },

    setMeshPrecision(precision) {
      if (['low', 'medium', 'high'].includes(precision)) {
        meshPrecision = precision
        notifyState()
      }
    },

    setBlindZoneVisible(visible) {
      viewshedLayerVisible = !!visible
      applyLayerVisibility()
      viewer?.scene.requestRender()
    },

    setCityTileset(_tileset) {},

    toggleFrustumBoundsDebug(force) {
      boundsDebugVisible = force != null ? !!force : !boundsDebugVisible
      notifyState({ boundsDebugVisible })
      return boundsDebugVisible
    },

    updateFlightViewshed(_observer, _headingDeg) {
      if (mode === MODE.HOVER_SCAN || mode === MODE.HOVER_ANALYSE) return
      if (mode === MODE.FLIGHT) {
        mode = MODE.IDLE
        notifyState({ mode: MODE.IDLE })
      }
    },

    resetAllFrustums() {
      scanCancelled = true
      this.cancelScan()
      viewshedPool.clearAll()
      clearBlindZone(viewer)
      clearViewshedResult(viewer)
      lastExportData = null
      currentObserver = null
      currentWaypointMeta = null
      cumulativeVisibleM2 = 0
      cumulativeBlindM2 = 0
      mode = MODE.IDLE
      notifyState({
        savedWaypointCount: 0,
        visibleAreaM2: 0,
        blindAreaM2: 0,
        cumulativeVisibleM2: 0,
        cumulativeBlindM2: 0,
        areaSource: null,
      })
    },

    clearFlightViewshed() {
      viewshedPool.clearActiveScan()
      if (mode === MODE.FLIGHT) mode = MODE.IDLE
      viewer?.scene.requestRender()
    },

    setGimbalPitch(pitch) {
      gimbalPitch = Number.isFinite(pitch) ? pitch : config.pitchDeg
      notifyState()
    },

    stepGimbalManual(stepDeg = config.scanStepDeg) {
      if (mode !== MODE.HOVER_SCAN) return
      gimbalHeading = (gimbalHeading + stepDeg) % 360
      notifyState()
    },

    cancelScan() {
      scanCancelled = true
      viewshedPool.clearActiveScan()
      if (mode === MODE.HOVER_SCAN || mode === MODE.HOVER_ANALYSE) {
        mode = MODE.IDLE
      }
      notifyState({ scanning: false, analysing: false })
      scanCompleteResolve?.()
      scanCompleteResolve = null
    },

    async startHoverScan(observer, waypointMeta) {
      scanCancelled = true
      viewshedPool.clearActiveScan()
      scanCancelled = false
      mode = MODE.HOVER_SCAN
      currentObserver = observer
      currentWaypointMeta = waypointMeta
      gimbalHeading = 0

      const waypointId = waypointMeta?.id ?? `wp-${waypointMeta?.index ?? 0}`
      notifyState({
        scanning: true,
        analysing: false,
        scanProgress: 0,
        buildProgress: 0,
        visibleAreaM2: 0,
        blindAreaM2: 0,
        currentWaypointIndex: waypointMeta?.index ?? null,
        areaSource: null,
        savedWaypointCount: viewshedPool.getCount(),
      })

      const serverPromise = requestViewshed360Analysis({
        observerPosition: [observer.lng, observer.lat, observer.height],
        pitch: gimbalPitch,
        horizontalFov: config.hFovDeg,
        verticalFov: config.vFovDeg,
        distance: config.maxDistanceM,
        scanStepDeg: config.scanStepDeg,
        buildingsEnabled,
        terrainEnabled,
        meshPrecision,
        waypointMeta,
      }).catch((err) => {
        console.warn('[viewshed] 服务端分析失败，保留客户端立体结果:', err?.message || err)
        return null
      })

      return new Promise((resolve, reject) => {
        scanCompleteResolve = resolve

        viewshedPool
          .runWaypointAnalysis({
            waypointId,
            waypointIndex: waypointMeta?.index ?? 0,
            observer,
            pitchDeg: gimbalPitch,
            scanStepDeg: config.scanStepDeg,
            onHeading: (heading) => {
              gimbalHeading = heading
              config.onScanProgress({ heading, progress: heading / 360 })
            },
            onProgress: (progress, phase) => {
              if (scanCancelled) return
              if (phase === 'scan') {
                mode = MODE.HOVER_SCAN
                notifyState({
                  scanning: true,
                  analysing: false,
                  scanProgress: progress / 0.68,
                  buildProgress: 0,
                  gimbalHeading,
                  savedWaypointCount: viewshedPool.getCount(),
                })
              } else {
                mode = MODE.HOVER_ANALYSE
                notifyState({
                  scanning: false,
                  analysing: true,
                  scanProgress: 1,
                  buildProgress: phase === 'done' ? 1 : Math.min(1, (progress - 0.68) / 0.22),
                  gimbalHeading,
                  savedWaypointCount: viewshedPool.getCount(),
                })
              }
            },
            isCancelled: isScanCancelled,
          })
          .then(async () => {
            if (scanCancelled) {
              scanCompleteResolve?.()
              scanCompleteResolve = null
              return
            }

            mode = MODE.HOVER_ANALYSE
            notifyState({ analysing: true, scanning: false, buildProgress: 1 })

            let result = null
            try {
              result = await withTimeout(serverPromise, SERVER_ANALYSIS_TIMEOUT_MS, '服务端可视域')
            } catch (err) {
              console.warn('[viewshed] 服务端分析超时，已保留客户端立体可视域:', err?.message || err)
            }

            const areaSnapshot = {
              lng: observer.lng,
              lat: observer.lat,
              height: observer.height,
              heading: gimbalHeading,
              pitch: gimbalPitch,
              horizontalFov: config.hFovDeg,
              verticalFov: config.vFovDeg,
              distanceM: config.maxDistanceM,
            }
            const areas = resolveViewshedAreas(result, areaSnapshot, { fullCircle: true })
            cumulativeVisibleM2 += areas.visibleAreaM2
            cumulativeBlindM2 += areas.blindAreaM2

            lastExportData = {
              ...(result?.exportJson || {}),
              waypoint: waypointMeta,
              visibleAreaM2: areas.visibleAreaM2,
              blindAreaM2: areas.blindAreaM2,
              footprintAreaM2: areas.footprintAreaM2,
              blindRatio: areas.blindRatio,
              areaSource: areas.source,
              blindZoneGeoJson: result?.blindZoneGeoJson ?? result?.exportJson?.blindZoneGeoJson ?? null,
              analysisMode: 'viewshed3d_waypoint_pool',
            }

            currentWaypointMeta = {
              ...waypointMeta,
              lastExport: lastExportData,
              visibleAreaM2: areas.visibleAreaM2,
              blindAreaM2: areas.blindAreaM2,
              areaSource: areas.source,
            }

            const areaValidation = result?.areaValidation ?? {
              ok: true,
              info: areas.source === 'remote'
                ? '面积来自远端空间分析服务'
                : '面积按航点视锥几何估算（随位置/高度变化）',
            }

            config.onAnalyseComplete({
              waypointMeta: currentWaypointMeta,
              visibleAreaM2: areas.visibleAreaM2,
              blindAreaM2: areas.blindAreaM2,
              exportJson: lastExportData,
              areaValidation,
              footprintAreaM2: areas.footprintAreaM2,
              bboxFilterStats: result?.bboxFilterStats ?? null,
              boundsDebugVisible,
              areaSource: areas.source,
              cumulativeVisibleM2,
              cumulativeBlindM2,
            })

            mode = MODE.IDLE
            notifyState({
              visibleAreaM2: areas.visibleAreaM2,
              blindAreaM2: areas.blindAreaM2,
              footprintAreaM2: areas.footprintAreaM2,
              areaSource: areas.source,
              cumulativeVisibleM2,
              cumulativeBlindM2,
              currentWaypointIndex: waypointMeta?.index ?? null,
              canExport: true,
              scanning: false,
              analysing: false,
              scanProgress: 1,
              buildProgress: 1,
              savedWaypointCount: viewshedPool.getCount(),
            })
            scanCompleteResolve?.()
            scanCompleteResolve = null
            viewer?.scene.requestRender()
          })
          .catch((err) => {
            console.warn('[viewshed] 航点可视域分析异常:', err?.message || err)
            mode = MODE.IDLE
            viewshedPool.clearActiveScan()
            notifyState({ error: err?.message, scanning: false, analysing: false })
            scanCompleteResolve?.()
            scanCompleteResolve = null
            resolve()
          })
      })
    },

    async exportBlindZoneJson() {
      if (!lastExportData) {
        throw new Error('暂无可导出的立体盲区数据，请先完成航点环视')
      }
      return JSON.stringify(lastExportData, null, 2)
    },

    getLastExportData() {
      return lastExportData
    },

    destroy() {
      this.resetAllFrustums()
      viewshedPool.destroy()
    },
  }
}

export { MODE as VIEWSHED_MODE }
