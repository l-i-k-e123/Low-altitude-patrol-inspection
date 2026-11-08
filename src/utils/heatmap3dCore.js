/**
 * heatmap3dCore.js — 3D 热力图核心引擎（Cesium）
 *
 * 高度在 JS 侧写入网格顶点，不使用自定义 vertexShader（避免 czm_computePosition 链接失败）。
 */
import Cesium from '@/utils/cesiumCompat'

const H337_SRC = '/libs/h337-heatmap.js'

let h337Promise = null

function loadH337() {
  if (window.h337?.create) return Promise.resolve(window.h337)
  if (h337Promise) return h337Promise

  h337Promise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = H337_SRC
    script.onload = () => {
      if (window.h337?.create) resolve(window.h337)
      else reject(new Error('h337 未正确加载'))
    }
    script.onerror = () => reject(new Error('heatmap.js 加载失败'))
    document.head.appendChild(script)
  })
  return h337Promise
}

function cartesianToLngLat(cartesian) {
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
  return [
    Cesium.Math.toDegrees(cartographic.longitude),
    Cesium.Math.toDegrees(cartographic.latitude),
    cartographic.height,
  ]
}

function cartesiansToLngLats(cartesians) {
  return cartesians.map((c) => cartesianToLngLat(c))
}

function computeBoundingBox(positions, heatmapState) {
  const boundingSphere = Cesium.BoundingSphere.fromPoints(positions, new Cesium.BoundingSphere())
  const centerPoint = boundingSphere.center
  const sphereRadius = boundingSphere.radius

  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerPoint.clone())
  const yAxisVector = new Cesium.Cartesian3(0, 1, 0)
  const boundingVertices = []

  for (let angle = 45; angle <= 360; angle += 90) {
    const rotationMatrix = Cesium.Matrix3.fromRotationZ(
      Cesium.Math.toRadians(angle),
      new Cesium.Matrix3(),
    )
    let rotatedYAxis = Cesium.Matrix3.multiplyByVector(
      rotationMatrix,
      yAxisVector,
      new Cesium.Cartesian3(),
    )
    rotatedYAxis = Cesium.Cartesian3.normalize(rotatedYAxis, new Cesium.Cartesian3())
    const scaledVector = Cesium.Cartesian3.multiplyByScalar(
      rotatedYAxis,
      sphereRadius,
      new Cesium.Cartesian3(),
    )
    const vertex = Cesium.Matrix4.multiplyByPoint(
      modelMatrix,
      scaledVector.clone(),
      new Cesium.Cartesian3(),
    )
    boundingVertices.push(vertex)
  }

  const coordinates = cartesiansToLngLats(boundingVertices)
  let minLatitude = Number.MAX_VALUE
  let maxLatitude = Number.MIN_VALUE
  let minLongitude = Number.MAX_VALUE
  let maxLongitude = Number.MIN_VALUE
  const vertexCount = boundingVertices.length

  coordinates.forEach((coordinate) => {
    if (coordinate[0] < minLongitude) minLongitude = coordinate[0]
    if (coordinate[0] > maxLongitude) maxLongitude = coordinate[0]
    if (coordinate[1] < minLatitude) minLatitude = coordinate[1]
    if (coordinate[1] > maxLatitude) maxLatitude = coordinate[1]
  })

  const latitudeRange = maxLatitude - minLatitude
  const longitudeRange = maxLongitude - minLongitude

  heatmapState.boundingRect = {
    minLatitude: minLatitude - latitudeRange / vertexCount,
    maxLatitude: maxLatitude + latitudeRange / vertexCount,
    minLongitude: minLongitude - longitudeRange / vertexCount,
    maxLongitude: maxLongitude + longitudeRange / vertexCount,
  }

  heatmapState.boundingBox = {
    leftTop: Cesium.Cartesian3.fromDegrees(
      heatmapState.boundingRect.minLongitude,
      heatmapState.boundingRect.maxLatitude,
    ),
    leftBottom: Cesium.Cartesian3.fromDegrees(
      heatmapState.boundingRect.minLongitude,
      heatmapState.boundingRect.minLatitude,
    ),
    rightTop: Cesium.Cartesian3.fromDegrees(
      heatmapState.boundingRect.maxLongitude,
      heatmapState.boundingRect.maxLatitude,
    ),
    rightBottom: Cesium.Cartesian3.fromDegrees(
      heatmapState.boundingRect.maxLongitude,
      heatmapState.boundingRect.minLatitude,
    ),
  }

  heatmapState.xAxis = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(
      heatmapState.boundingBox.rightTop,
      heatmapState.boundingBox.leftTop,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  )
  heatmapState.yAxis = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(
      heatmapState.boundingBox.leftBottom,
      heatmapState.boundingBox.leftTop,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  )
  heatmapState.xAxisLength = Cesium.Cartesian3.distance(
    heatmapState.boundingBox.rightTop,
    heatmapState.boundingBox.leftTop,
  )
  heatmapState.yAxisLength = Cesium.Cartesian3.distance(
    heatmapState.boundingBox.leftBottom,
    heatmapState.boundingBox.leftTop,
  )
}

function computeNormalizedCoordinates(position, heatmapState) {
  const cartographic = Cesium.Cartographic.fromCartesian(position.clone())
  cartographic.height = 0
  const flatPosition = Cesium.Cartographic.toCartesian(cartographic.clone())

  const originVector = Cesium.Cartesian3.subtract(
    flatPosition.clone(),
    heatmapState.boundingBox.leftTop,
    new Cesium.Cartesian3(),
  )
  const xOffset = Cesium.Cartesian3.dot(originVector, heatmapState.xAxis)
  const yOffset = Cesium.Cartesian3.dot(originVector, heatmapState.yAxis)

  return {
    x: Number((xOffset / heatmapState.xAxisLength) * heatmapState.canvasWidth).toFixed(0),
    y: Number((yOffset / heatmapState.yAxisLength) * heatmapState.canvasWidth).toFixed(0),
  }
}

/** h337 getValueAt 返回 0–255，映射为绝对高度（含 floorOffset，避免贴椭球 z-fighting） */
function sampleHeatNormalized(heatmapState, x, y) {
  const raw = heatmapState.heatmapInstance.getValueAt({ x, y }) || 0
  return Math.min(1, Math.max(0, raw / 255))
}

function buildSmoothedHeightGrid(heatmapState) {
  const size = heatmapState.canvasWidth || 200
  const raw = new Float64Array(size * size)
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      raw[i * size + j] = sampleHeatNormalized(heatmapState, i, j)
    }
  }

  const passes = heatmapState.smoothPasses ?? 2
  let src = raw
  let dst = new Float64Array(size * size)
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        let sum = 0
        let count = 0
        for (let di = -1; di <= 1; di += 1) {
          for (let dj = -1; dj <= 1; dj += 1) {
            const ni = i + di
            const nj = j + dj
            if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
              sum += src[ni * size + nj]
              count += 1
            }
          }
        }
        dst[i * size + j] = sum / count
      }
    }
    const swap = src
    src = dst
    dst = swap
  }
  return src
}

function heightFromNormalized(heatmapState, normalized) {
  const floor = heatmapState.floorOffset ?? 15
  return floor + normalized * heatmapState.heightScale
}

function generateMeshData(heatmapState) {
  const gridWidth = heatmapState.canvasWidth || 200
  const gridHeight = heatmapState.canvasWidth || 200
  const { maxLongitude, maxLatitude, minLongitude, minLatitude } = heatmapState.boundingRect
  const heightGrid = buildSmoothedHeightGrid(heatmapState)

  const longitudeStep = (maxLongitude - minLongitude) / gridWidth
  const latitudeStep = (maxLatitude - minLatitude) / gridHeight
  const positions = []
  const textureCoords = []
  const indices = []

  for (let i = 0; i < gridWidth; i += 1) {
    const currentLongitude = minLongitude + longitudeStep * i
    for (let j = 0; j < gridHeight; j += 1) {
      const currentLatitude = minLatitude + latitudeStep * j
      const normalized = heightGrid[i * gridHeight + j]
      const heightM = heightFromNormalized(heatmapState, normalized)
      const cartesian3 = Cesium.Cartesian3.fromDegrees(
        currentLongitude,
        currentLatitude,
        heightM,
      )
      positions.push(cartesian3.x, cartesian3.y, cartesian3.z)
      textureCoords.push((i + 0.5) / gridWidth, (j + 0.5) / gridHeight)
      if (j !== gridHeight - 1 && i !== gridWidth - 1) {
        indices.push(i * gridHeight + j, i * gridHeight + j + 1, (i + 1) * gridHeight + j)
        indices.push(
          (i + 1) * gridHeight + j,
          (i + 1) * gridHeight + j + 1,
          i * gridHeight + j + 1,
        )
      }
    }
  }

  return { positions, textureCoords, indices }
}

function createHeatmapGeometry(heatmapState) {
  const meshData = generateMeshData(heatmapState)
  return new Cesium.Geometry({
    attributes: new Cesium.GeometryAttributes({
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: meshData.positions,
      }),
      st: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: new Float32Array(meshData.textureCoords),
      }),
    }),
    indices: new Uint16Array(meshData.indices),
    primitiveType: Cesium.PrimitiveType[heatmapState.primitiveType],
    boundingSphere: Cesium.BoundingSphere.fromVertices(meshData.positions),
  })
}

function createHeatmapContainer(heatmapState) {
  const el = document.createElement('div')
  el.id = `heatmap-${heatmapState.instanceId}`
  el.className = 'heatmap'
  el.style.width = `${heatmapState.canvasWidth}px`
  el.style.height = `${heatmapState.canvasWidth}px`
  el.style.position = 'absolute'
  el.style.display = 'none'
  el.style.pointerEvents = 'none'
  heatmapState.viewer.container.appendChild(el)
  heatmapState.containerElement = el
}

/** h337 频繁 getValueAt 时消除 Canvas2D 警告 */
function tuneHeatmapCanvas(containerEl) {
  const canvas = containerEl?.querySelector?.('canvas')
  if (!canvas) return
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx && canvas.width) {
      ctx.fillRect(0, 0, 1, 1)
    }
  } catch {
    /* ignore */
  }
}

function buildHeatmapRenderState() {
  if (!Cesium.RenderState?.fromCache) return undefined
  try {
    return Cesium.RenderState.fromCache({
      depthTest: { enabled: true },
      depthMask: true,
      blending: Cesium.BlendingState?.ALPHA_BLEND,
      cull: { enabled: false },
      polygonOffset: {
        enabled: true,
        factor: 2,
        units: 4,
      },
    })
  } catch {
    return undefined
  }
}

function buildHeatmapAppearance(heatmapImage) {
  const renderState = buildHeatmapRenderState()
  return new Cesium.MaterialAppearance({
    material: Cesium.Material.fromType('Image', {
      image: heatmapImage,
    }),
    translucent: true,
    flat: true,
    closed: false,
    faceForward: false,
    ...(renderState ? { renderState } : {}),
  })
}

function installHeatmapStableRender(heatmapState) {
  const { viewer, heatmapPrimitive } = heatmapState
  if (!viewer || !heatmapPrimitive) return

  try {
    viewer.scene.primitives.raiseToTop(heatmapPrimitive)
  } catch {
    /* ignore */
  }

  if (heatmapState._cameraMoveEndRemover) {
    heatmapState._cameraMoveEndRemover()
    heatmapState._cameraMoveEndRemover = null
  }

  const onMoveEnd = () => {
    if (!heatmapState.heatmapPrimitive || viewer.isDestroyed?.()) return
    try {
      viewer.scene.primitives.raiseToTop(heatmapState.heatmapPrimitive)
      viewer.scene.requestRender()
    } catch {
      /* ignore */
    }
  }

  viewer.camera.moveEnd.addEventListener(onMoveEnd)
  heatmapState._cameraMoveEndRemover = () => {
    try {
      viewer.camera.moveEnd.removeEventListener(onMoveEnd)
    } catch {
      /* ignore */
    }
  }
}

function initializeHeatmap(heatmapState) {
  heatmapState.positionHierarchy = heatmapState.dataPoints.map((dp) =>
    Cesium.Cartesian3.fromDegrees(dp.lnglat[0], dp.lnglat[1], 0),
  )

  computeBoundingBox(heatmapState.positionHierarchy, heatmapState)

  const heatmapPoints = heatmapState.dataPoints.map((dp, index) => {
    const normalized = computeNormalizedCoordinates(
      heatmapState.positionHierarchy[index],
      heatmapState,
    )
    return { x: normalized.x, y: normalized.y, value: dp.value }
  })

  heatmapState.heatmapInstance.setData({
    max: heatmapState.maxValue,
    min: 0,
    data: heatmapPoints,
  })

  tuneHeatmapCanvas(heatmapState.containerElement)

  const geometryInstance = new Cesium.GeometryInstance({
    geometry: createHeatmapGeometry(heatmapState),
  })

  const heatmapImage = heatmapState.heatmapInstance.getDataURL()

  heatmapState.heatmapPrimitive = heatmapState.viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: geometryInstance,
      appearance: buildHeatmapAppearance(heatmapImage),
      asynchronous: false,
      allowPicking: false,
    }),
  )

  installHeatmapStableRender(heatmapState)
}

/**
 * @param {Cesium.Viewer} viewer
 * @param {Object} options
 * @param {Array<{lnglat:[number,number], value:number}>} options.dataPoints
 */
export async function create3DHeatmap(viewer, options = {}) {
  await loadH337()

  const dataPoints = options.dataPoints || []
  if (dataPoints.length < 2) {
    console.warn('3D 热力图至少需要 2 个点位')
    return null
  }

  const heatmapState = {
    viewer,
    options,
    dataPoints,
    instanceId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    canvasWidth: options.canvasWidth ?? 180,
    baseElevation: options.baseElevation ?? 0,
    floorOffset: options.floorOffset ?? 15,
    heightScale: options.heightScale ?? 650,
    smoothPasses: options.smoothPasses ?? 2,
    primitiveType: options.primitiveType || 'TRIANGLES',
    maxValue: options.maxValue ?? Math.max(...dataPoints.map((d) => d.value), 100),
    heatmapPrimitive: null,
    containerElement: null,
    heatmapInstance: null,
  }

  createHeatmapContainer(heatmapState)

  const h337 = window.h337
  heatmapState.heatmapInstance = h337.create({
    container: document.getElementById(`heatmap-${heatmapState.instanceId}`),
    radius: options.radius ?? 22,
    maxOpacity: options.maxOpacity ?? 0.75,
    minOpacity: 0,
    blur: options.blur ?? 0.75,
    gradient: options.colorGradient || {
      0.25: 'rgb(0,0,255)',
      0.55: 'rgb(0,255,0)',
      0.85: 'yellow',
      1.0: 'rgb(255,0,0)',
    },
  })

  initializeHeatmap(heatmapState)
  viewer.scene.requestRender()

  return {
    destroy: () => destroy3DHeatmap({ heatmapState }),
    heatmapState,
  }
}

export function destroy3DHeatmap(handle) {
  const state = handle?.heatmapState
  if (!state) return

  state._cameraMoveEndRemover?.()
  state._cameraMoveEndRemover = null

  const container = document.getElementById(`heatmap-${state.instanceId}`)
  if (container) container.remove()

  if (state.heatmapPrimitive && state.viewer && !state.viewer.isDestroyed()) {
    state.viewer.scene.primitives.remove(state.heatmapPrimitive)
    state.viewer.scene.requestRender()
  }

  state.heatmapPrimitive = null
  state.heatmapInstance = null
}
