/**
 * surveyMeasureManager.js — 基础测绘工具（距离 / 面积 / 单点经纬度）
 * 图形独立存入 PrimitiveCollection，轻量同步计算，不占用 Worker。
 */
import Cesium from '@/utils/cesiumCompat'
import { distM2D, distM3D, polygonAreaM2 } from './latlng.js'

const TOOL = {
  NONE: 'none',
  DISTANCE: 'distance',
  AREA: 'area',
  ELEVATION: 'elevation',
}

const LINE_COLOR = Cesium.Color.fromCssColorString('#00aaff')
const FILL_COLOR = Cesium.Color.fromCssColorString('rgba(100, 220, 230, 0.35)')
const VERTEX_COLOR = Cesium.Color.WHITE

const SUBDIVISION = {
  low: 0,
  medium: 1,
  high: 2,
}

function formatDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${m.toFixed(2)} m`
}

function formatArea(m2) {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} 万㎡`
  return `${m2.toFixed(2)} ㎡`
}

function makeLabelStyle() {
  return {
    font: '12px sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString('rgba(0, 0, 0, 0.55)'),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    pixelOffset: new Cesium.Cartesian2(0, -8),
  }
}

function triangleArea3D(a, b, c) {
  const ab = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3())
  const ac = Cesium.Cartesian3.subtract(c, a, new Cesium.Cartesian3())
  const cross = Cesium.Cartesian3.cross(ab, ac, new Cesium.Cartesian3())
  return Cesium.Cartesian3.magnitude(cross) * 0.5
}

function lngLatFromCartesian(cartesian) {
  const carto = Cesium.Cartographic.fromCartesian(cartesian)
  return {
    lng: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height ?? 0,
  }
}

function pickSurface(viewer, screenPosition) {
  const scene = viewer.scene
  if (scene.pickPositionSupported) {
    const picked = scene.pickPosition(screenPosition)
    if (Cesium.defined(picked)) return picked
  }
  const ray = viewer.camera.getPickRay(screenPosition)
  if (!ray) return null
  return scene.globe.pick(ray, scene)
}

function sampleHeight(viewer, lng, lat) {
  const carto = Cesium.Cartographic.fromDegrees(lng, lat)
  const h = viewer.scene.globe.getHeight(carto)
  return h ?? 0
}

function cartesianFromLngLat(viewer, lng, lat) {
  const h = sampleHeight(viewer, lng, lat)
  return Cesium.Cartesian3.fromDegrees(lng, lat, h)
}

function computeSurfaceArea3D(viewer, ring, subdivisions) {
  if (!ring || ring.length < 3) return 0
  const pts = ring.map((p) => ({
    lng: p.lng,
    lat: p.lat,
    height: sampleHeight(viewer, p.lng, p.lat),
  }))

  const toCart = (p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height)
  let total = 0
  const anchor = pts[0]

  for (let i = 1; i < pts.length - 1; i++) {
    total += accumulateTriangleArea(viewer, [anchor, pts[i], pts[i + 1]], subdivisions)
  }
  return total
}

function accumulateTriangleArea(viewer, triPts, subdivisions) {
  const carts = triPts.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height))
  if (subdivisions <= 0) {
    return triangleArea3D(carts[0], carts[1], carts[2])
  }

  const mid01 = midpointLngLat(viewer, triPts[0], triPts[1])
  const mid12 = midpointLngLat(viewer, triPts[1], triPts[2])
  const mid20 = midpointLngLat(viewer, triPts[2], triPts[0])
  const next = subdivisions - 1

  return (
    accumulateTriangleArea(viewer, [triPts[0], mid01, mid20], next)
    + accumulateTriangleArea(viewer, [triPts[1], mid12, mid01], next)
    + accumulateTriangleArea(viewer, [triPts[2], mid20, mid12], next)
    + accumulateTriangleArea(viewer, [mid01, mid12, mid20], next)
  )
}

function midpointLngLat(viewer, a, b) {
  const lng = (a.lng + b.lng) / 2
  const lat = (a.lat + b.lat) / 2
  return { lng, lat, height: sampleHeight(viewer, lng, lat) }
}

function polygonCentroid(ring) {
  let sx = 0
  let sy = 0
  for (const p of ring) {
    sx += p.lng
    sy += p.lat
  }
  return { lng: sx / ring.length, lat: sy / ring.length }
}

function closestSegmentInfo(point, segments) {
  let best = null
  for (const seg of segments) {
    const t = closestPointOnSegment(point, seg.a, seg.b)
    const dist = distM2D(point.lng, point.lat, t.lng, t.lat)
    if (!best || dist < best.dist) {
      best = { dist, seg, mid: t, length: seg.length }
    }
  }
  return best
}

function closestPointOnSegment(p, a, b) {
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-14) return { lng: a.lng, lat: a.lat }
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { lng: a.lng + t * dx, lat: a.lat + t * dy }
}

function createPinCanvas() {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.beginPath()
  ctx.moveTo(size / 2, size - 4)
  ctx.lineTo(size / 2 - 10, size / 2)
  ctx.lineTo(size / 2, 6)
  ctx.lineTo(size / 2 + 10, size / 2)
  ctx.closePath()
  ctx.fillStyle = '#ff3333'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.stroke()
  return canvas.toDataURL()
}

export function createSurveyMeasureManager(viewer, options = {}) {
  const config = {
    meshPrecision: options.meshPrecision ?? 'high',
    onStateChange: options.onStateChange ?? (() => {}),
  }

  const root = new Cesium.PrimitiveCollection()
  viewer.scene.primitives.add(root)

  const groundLayer = new Cesium.PrimitiveCollection()
  const lineLayer = new Cesium.PolylineCollection()
  const pointLayer = new Cesium.PointPrimitiveCollection()
  const labelLayer = new Cesium.LabelCollection()
  const billboardLayer = new Cesium.BillboardCollection()

  root.add(groundLayer)
  root.add(lineLayer)
  root.add(pointLayer)
  root.add(labelLayer)
  root.add(billboardLayer)

  let activeTool = TOOL.NONE
  let meshPrecision = config.meshPrecision
  let handler = null

  let distanceDraft = []
  let distanceDraftLine = null
  let distanceDraftLabels = []
  let distanceDraftPoints = []
  let distanceFinished = []
  let distanceSegments = []
  let distanceTotalLabel = null
  let hoverLabel = null

  let areaDraft = []
  let areaDraftLine = null
  let areaDraftPoints = []
  let areaGroundPrimitive = null
  let areaOutline = null
  let areaPoints = []
  let areaCenterLabel = null

  let elevationMarkers = []
  let pinImage = null

  const emitState = () => {
    config.onStateChange({
      activeTool,
      distanceTotalM: getDistanceTotalM(),
      areaPlaneM2: areaDraft.length >= 3 ? polygonAreaM2(areaDraft) : 0,
      areaSurfaceM2: areaDraft.length >= 3 ? computeSurfaceArea3D(viewer, areaDraft, SUBDIVISION[meshPrecision] ?? 2) : 0,
      elevationCount: elevationMarkers.length,
    })
  }

  const requestRender = () => viewer?.scene?.requestRender?.()

  const getSubdivisions = () => SUBDIVISION[meshPrecision] ?? SUBDIVISION.high

  const getDistanceTotalM = () => {
    let total = distanceFinished.reduce((s, item) => s + item.totalM, 0)
    if (distanceDraft.length >= 2) {
      for (let i = 1; i < distanceDraft.length; i++) {
        total += distM3D(distanceDraft[i - 1], distanceDraft[i])
      }
    }
    return total
  }

  const removeLabel = (label) => {
    if (label) labelLayer.remove(label)
  }

  const addVertexPoint = (cartesian) => {
    return pointLayer.add({
      position: cartesian,
      color: VERTEX_COLOR,
      pixelSize: 8,
      outlineColor: Cesium.Color.fromCssColorString('#0088cc'),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    })
  }

  const addPolyline = (positions) => {
    return lineLayer.add({
      positions,
      width: 3,
      material: Cesium.Material.fromType('Color', { color: LINE_COLOR }),
    })
  }

  const addTextLabel = (position, text, offsetY = -8) => {
    return labelLayer.add({
      position,
      text,
      ...makeLabelStyle(),
      pixelOffset: new Cesium.Cartesian2(0, offsetY),
    })
  }

  const clearDistanceGraphics = () => {
    for (const line of distanceFinished) {
      if (line.polyline) lineLayer.remove(line.polyline)
      for (const lbl of line.labels) removeLabel(lbl)
      for (const pt of line.points) pointLayer.remove(pt)
    }
    distanceFinished = []
    distanceSegments = []
    if (distanceDraftLine) {
      lineLayer.remove(distanceDraftLine)
      distanceDraftLine = null
    }
    for (const lbl of distanceDraftLabels) removeLabel(lbl)
    distanceDraftLabels = []
    for (const pt of distanceDraftPoints) pointLayer.remove(pt)
    distanceDraftPoints = []
    if (distanceTotalLabel) {
      removeLabel(distanceTotalLabel)
      distanceTotalLabel = null
    }
    distanceDraft = []
    if (hoverLabel) {
      removeLabel(hoverLabel)
      hoverLabel = null
    }
  }

  const clearAreaGraphics = () => {
    areaDraft = []
    if (areaDraftLine) {
      lineLayer.remove(areaDraftLine)
      areaDraftLine = null
    }
    for (const pt of areaDraftPoints) pointLayer.remove(pt)
    areaDraftPoints = []
    if (areaGroundPrimitive) {
      groundLayer.remove(areaGroundPrimitive)
      areaGroundPrimitive = null
    }
    if (areaOutline) {
      lineLayer.remove(areaOutline)
      areaOutline = null
    }
    for (const pt of areaPoints) pointLayer.remove(pt)
    areaPoints = []
    if (areaCenterLabel) {
      removeLabel(areaCenterLabel)
      areaCenterLabel = null
    }
  }

  const clearElevationGraphics = () => {
    for (const m of elevationMarkers) {
      if (m.billboard) billboardLayer.remove(m.billboard)
      if (m.label) removeLabel(m.label)
    }
    elevationMarkers = []
  }

  const clearActiveToolGraphics = () => {
    if (activeTool === TOOL.DISTANCE) clearDistanceGraphics()
    else if (activeTool === TOOL.AREA) clearAreaGraphics()
    else if (activeTool === TOOL.ELEVATION) clearElevationGraphics()
    requestRender()
    emitState()
  }

  const rebuildDistanceSegments = () => {
    distanceSegments = []
    const collectFromLine = (pts) => {
      for (let i = 1; i < pts.length; i++) {
        const len = distM3D(pts[i - 1], pts[i])
        distanceSegments.push({
          a: pts[i - 1],
          b: pts[i],
          length: len,
          mid: {
            lng: (pts[i - 1].lng + pts[i].lng) / 2,
            lat: (pts[i - 1].lat + pts[i].lat) / 2,
          },
        })
      }
    }
    for (const item of distanceFinished) collectFromLine(item.points)
    if (distanceDraft.length >= 2) collectFromLine(distanceDraft)
  }

  const updateDistanceTotalLabel = () => {
    if (distanceTotalLabel) removeLabel(distanceTotalLabel)
    distanceTotalLabel = null
    const total = getDistanceTotalM()
    if (total <= 0) return
    const allPts = [
      ...distanceFinished.flatMap((f) => f.points),
      ...distanceDraft,
    ]
    if (!allPts.length) return
    const last = allPts[allPts.length - 1]
    const pos = cartesianFromLngLat(viewer, last.lng, last.lat)
    distanceTotalLabel = addTextLabel(pos, `总长 ${formatDistance(total)}`, -14)
  }

  const finishDistanceLine = () => {
    if (distanceDraft.length < 2) {
      for (const pt of distanceDraftPoints) pointLayer.remove(pt)
      distanceDraftPoints = []
      for (const lbl of distanceDraftLabels) removeLabel(lbl)
      distanceDraftLabels = []
      if (distanceDraftLine) {
        lineLayer.remove(distanceDraftLine)
        distanceDraftLine = null
      }
      distanceDraft = []
      emitState()
      requestRender()
      return
    }

    const draftCopy = [...distanceDraft]
    const positions = draftCopy.map((p) => cartesianFromLngLat(viewer, p.lng, p.lat))
    const polyline = addPolyline(positions)
    const labels = [...distanceDraftLabels]
    const points = [...distanceDraftPoints]
    let totalM = 0
    for (let i = 1; i < draftCopy.length; i++) {
      totalM += distM3D(draftCopy[i - 1], draftCopy[i])
    }

    if (distanceDraftLine) {
      lineLayer.remove(distanceDraftLine)
      distanceDraftLine = null
    }
    distanceDraft = []
    distanceDraftLabels = []
    distanceDraftPoints = []

    distanceFinished.push({ points: draftCopy, polyline, labels, points, totalM })
    rebuildDistanceSegments()
    updateDistanceTotalLabel()
    emitState()
    requestRender()
  }

  const addDistancePoint = (lng, lat) => {
    const height = sampleHeight(viewer, lng, lat)
    distanceDraft.push({ lng, lat, height })
    const pos = Cesium.Cartesian3.fromDegrees(lng, lat, height)
    distanceDraftPoints.push(addVertexPoint(pos))

    if (distanceDraft.length >= 2) {
      const prev = distanceDraft[distanceDraft.length - 2]
      const cur = distanceDraft[distanceDraft.length - 1]
      const segLen = distM3D(prev, cur)
      const mid = midpointLngLat(viewer, prev, cur)
      const midPos = Cesium.Cartesian3.fromDegrees(mid.lng, mid.lat, mid.height)
      distanceDraftLabels.push(addTextLabel(midPos, formatDistance(segLen)))

      const positions = distanceDraft.map((p) => cartesianFromLngLat(viewer, p.lng, p.lat))
      if (distanceDraftLine) lineLayer.remove(distanceDraftLine)
      distanceDraftLine = addPolyline(positions)
    }

    rebuildDistanceSegments()
    updateDistanceTotalLabel()
    emitState()
    requestRender()
  }

  const renderAreaPolygon = (ring) => {
    clearAreaGraphics()
    areaDraft = ring.map((p) => ({ lng: p.lng, lat: p.lat }))
    const positions = ring.map((p) => cartesianFromLngLat(viewer, p.lng, p.lat))
    const closed = [...positions, positions[0]]

    const subdiv = getSubdivisions()
    const hierarchy = new Cesium.PolygonHierarchy(positions)
    const geometry = new Cesium.PolygonGeometry({
      polygonHierarchy: hierarchy,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      granularity: subdiv === 0 ? Cesium.Math.toRadians(2) : subdiv === 1 ? Cesium.Math.toRadians(0.5) : Cesium.Math.toRadians(0.1),
    })

    areaGroundPrimitive = new Cesium.GroundPrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(FILL_COLOR),
        },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: true }),
      classificationType: Cesium.ClassificationType.TERRAIN,
    })
    groundLayer.add(areaGroundPrimitive)

    areaOutline = addPolyline(closed)
    for (const pos of positions) {
      areaPoints.push(addVertexPoint(pos))
    }

    const planeM2 = polygonAreaM2(ring)
    const surfaceM2 = computeSurfaceArea3D(viewer, ring, subdiv)
    const center = polygonCentroid(ring)
    const centerH = sampleHeight(viewer, center.lng, center.lat)
    const centerPos = Cesium.Cartesian3.fromDegrees(center.lng, center.lat, centerH)
    areaCenterLabel = addTextLabel(
      centerPos,
      `投影 ${formatArea(planeM2)}\n曲面 ${formatArea(surfaceM2)}`,
      0,
    )
    emitState()
    requestRender()
  }

  const addAreaPoint = (lng, lat) => {
    if (areaGroundPrimitive || areaCenterLabel) {
      clearAreaGraphics()
    }
    areaDraft.push({ lng, lat })
    const pos = cartesianFromLngLat(viewer, lng, lat)
    areaDraftPoints.push(addVertexPoint(pos))
    const positions = areaDraft.map((p) => cartesianFromLngLat(viewer, p.lng, p.lat))
    if (areaDraftLine) lineLayer.remove(areaDraftLine)
    if (positions.length >= 2) {
      areaDraftLine = addPolyline(positions)
    }
    emitState()
    requestRender()
  }

  const finishAreaPolygon = () => {
    if (areaDraft.length < 3) return
    const ring = [...areaDraft]
    renderAreaPolygon(ring)
  }

  const ensurePinImage = () => {
    if (!pinImage) pinImage = createPinCanvas()
    return pinImage
  }

  const addElevationMarker = (lng, lat, height) => {
    const pos = Cesium.Cartesian3.fromDegrees(lng, lat, height)
    const billboard = billboardLayer.add({
      position: pos,
      image: ensurePinImage(),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scale: 0.7,
    })
    const label = addTextLabel(
      pos,
      `经度 ${lng.toFixed(6)}°\n纬度 ${lat.toFixed(6)}°`,
      -52,
    )
    elevationMarkers.push({ lng, lat, height, billboard, label })
    emitState()
    requestRender()
  }

  const handleMouseMove = (movement) => {
    if (activeTool !== TOOL.DISTANCE || !distanceSegments.length) {
      if (hoverLabel) {
        removeLabel(hoverLabel)
        hoverLabel = null
        requestRender()
      }
      return
    }
    const cartesian = pickSurface(viewer, movement.endPosition)
    if (!cartesian) return
    const pt = lngLatFromCartesian(cartesian)
    const hit = closestSegmentInfo(pt, distanceSegments)
    if (!hit || hit.dist > 30) {
      if (hoverLabel) {
        removeLabel(hoverLabel)
        hoverLabel = null
        requestRender()
      }
      return
    }
    const pos = cartesianFromLngLat(viewer, hit.mid.lng, hit.mid.lat)
    const text = formatDistance(hit.length)
    if (hoverLabel) {
      hoverLabel.position = pos
      hoverLabel.text = text
    } else {
      hoverLabel = addTextLabel(pos, text, -20)
    }
    requestRender()
  }

  const teardownHandler = () => {
    if (handler) {
      handler.destroy()
      handler = null
    }
  }

  const setupHandler = () => {
    teardownHandler()
    if (activeTool === TOOL.NONE || !viewer) return

    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((movement) => {
      const cartesian = pickSurface(viewer, movement.position)
      if (!cartesian) return
      const { lng, lat, height } = lngLatFromCartesian(cartesian)

      if (activeTool === TOOL.DISTANCE) {
        addDistancePoint(lng, lat)
      } else if (activeTool === TOOL.AREA) {
        addAreaPoint(lng, lat)
      } else if (activeTool === TOOL.ELEVATION) {
        addElevationMarker(lng, lat, height)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction(() => {
      if (activeTool === TOOL.DISTANCE) {
        finishDistanceLine()
      } else if (activeTool === TOOL.AREA) {
        finishAreaPolygon()
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    if (activeTool === TOOL.DISTANCE) {
      handler.setInputAction(handleMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    }
  }

  return {
    activateTool(tool) {
      const next = tool || TOOL.NONE
      if (next === activeTool) {
        if (next === TOOL.NONE) return
        clearActiveToolGraphics()
        activeTool = TOOL.NONE
        teardownHandler()
        emitState()
        return
      }
      if (activeTool !== TOOL.NONE) clearActiveToolGraphics()
      activeTool = next
      if (next === TOOL.NONE) {
        teardownHandler()
      } else {
        setupHandler()
      }
      emitState()
    },

    getActiveTool() {
      return activeTool
    },

    clearCurrent() {
      clearActiveToolGraphics()
    },

    clearAll() {
      clearDistanceGraphics()
      clearAreaGraphics()
      clearElevationGraphics()
      requestRender()
      emitState()
    },

    setMeshPrecision(precision) {
      if (precision in SUBDIVISION) {
        meshPrecision = precision
        if (areaDraft.length >= 3 && areaCenterLabel) {
          renderAreaPolygon(areaDraft)
        }
      }
    },

    destroy() {
      teardownHandler()
      if (viewer && !viewer.isDestroyed?.() && root) {
        viewer.scene.primitives.remove(root)
      }
    },
  }
}
