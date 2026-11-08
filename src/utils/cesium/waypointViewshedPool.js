/**
 * waypointViewshedPool.js
 * 多航点 ViewShed3D：扫描阶段仅霓虹特效，完成后再一次性 build（避免卡死）。
 */
import Cesium from '@/utils/cesiumCompat'

const SCAN_STEP_MS = 55
const BUILD_FX_STEP_MS = 70
const FX_PREFIX = 'vs3d-wp'
let viewshedNameSeq = 0

function allocViewshedName(waypointId, waypointIndex) {
  viewshedNameSeq += 1
  const safeId = String(waypointId ?? 'wp').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `vs_wp_${safeId}_${waypointIndex}_${viewshedNameSeq}`
}

const WAYPOINT_PALETTE = [
  { visible: 'rgba(0, 255, 230, 0.55)', hidden: 'rgba(255, 40, 130, 0.38)', glow: '#00ffe6', beam: '#40ffff' },
  { visible: 'rgba(72, 255, 128, 0.52)', hidden: 'rgba(255, 96, 32, 0.36)', glow: '#48ff80', beam: '#a0ff60' },
  { visible: 'rgba(110, 180, 255, 0.54)', hidden: 'rgba(255, 64, 200, 0.34)', glow: '#6eb4ff', beam: '#90d0ff' },
  { visible: 'rgba(255, 220, 72, 0.5)', hidden: 'rgba(190, 64, 255, 0.34)', glow: '#ffdc48', beam: '#ffe880' },
  { visible: 'rgba(190, 120, 255, 0.52)', hidden: 'rgba(255, 110, 64, 0.36)', glow: '#be78ff', beam: '#d8a0ff' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pickPalette(index = 0) {
  return WAYPOINT_PALETTE[Math.abs(index) % WAYPOINT_PALETTE.length]
}

function pulseAlpha(baseAlpha, phase, amp = 0.2) {
  return Cesium.Math.clamp(baseAlpha + Math.sin(phase) * amp, 0.14, 0.78)
}

function fxId(waypointId, suffix) {
  return `${FX_PREFIX}-${waypointId}-${suffix}`
}

function createNoopPool() {
  return {
    isSupported: () => false,
    getCount: () => 0,
    runWaypointAnalysis() { return Promise.resolve() },
    setLayerVisible() {},
    clearActiveScan() {},
    clearAll() {},
    destroy() {},
  }
}

function disposeViewshed3D(viewshed3D) {
  if (!viewshed3D) return
  try {
    if (typeof viewshed3D.clear === 'function') viewshed3D.clear()
  } catch { /* ignore */ }
  try {
    if (typeof viewshed3D.destroy === 'function') viewshed3D.destroy()
  } catch (err) {
    console.warn('[waypointViewshedPool] destroy viewshed failed:', err)
  }
}

/** 首次 build 注册；之后仅改颜色（不触发深度重建） */
function registerViewshed(entry, visible = true) {
  const { viewshed3D, palette, snapshot } = entry
  if (!viewshed3D || !snapshot || entry.registered) return

  viewshed3D.viewPosition = [snapshot.lng, snapshot.lat, snapshot.height]
  viewshed3D.direction = snapshot.heading
  viewshed3D.pitch = snapshot.pitch
  viewshed3D.horizontalFov = snapshot.horizontalFov
  viewshed3D.verticalFov = snapshot.verticalFov
  viewshed3D.distance = visible ? snapshot.distanceM : 0.1
  viewshed3D.visibleAreaColor = Cesium.Color.fromCssColorString(palette.visible).withAlpha(0.62)
  viewshed3D.hiddenAreaColor = Cesium.Color.fromCssColorString(palette.hidden).withAlpha(0.44)
  if ('isShowLine' in viewshed3D) viewshed3D.isShowLine = true
  if ('hintLineColor' in viewshed3D) {
    viewshed3D.hintLineColor = Cesium.Color.fromCssColorString(palette.glow).withAlpha(0.92)
  }
  viewshed3D.name = entry.viewshedName

  try {
    viewshed3D.build()
    entry.registered = true
  } catch (err) {
    console.warn('[waypointViewshedPool] build failed:', err)
  }
}

function pulseViewshedColors(entry, pulsePhase, visible) {
  if (!entry.registered || !entry.viewshed3D) return
  const { palette } = entry
  entry.viewshed3D.visibleAreaColor = Cesium.Color.fromCssColorString(palette.visible).withAlpha(
    pulseAlpha(0.5, pulsePhase),
  )
  entry.viewshed3D.hiddenAreaColor = Cesium.Color.fromCssColorString(palette.hidden).withAlpha(
    pulseAlpha(0.36, pulsePhase + 1.2),
  )
  entry.viewshed3D.distance = visible ? (entry.snapshot?.distanceM ?? 0.1) : 0.1
}

function setViewshedVisible(entry, visible) {
  if (!entry.viewshed3D) return
  if (!entry.registered) return
  entry.viewshed3D.distance = visible ? (entry.snapshot?.distanceM ?? 0.1) : 0.1
}

function buildHorizArc(lng, lat, height, headingDeg, radiusM, spreadDeg = 32) {
  const positions = []
  const latRad = Cesium.Math.toRadians(lat)
  const mPerDegLon = 111319 * Math.cos(latRad)
  const mPerDegLat = 111319
  const start = headingDeg - spreadDeg
  const end = headingDeg + spreadDeg
  for (let i = 0; i <= 16; i += 1) {
    const ang = Cesium.Math.toRadians(start + ((end - start) * i) / 16)
    positions.push(
      Cesium.Cartesian3.fromDegrees(
        lng + (Math.sin(ang) * radiusM) / mPerDegLon,
        lat + (Math.cos(ang) * radiusM) / mPerDegLat,
        height,
      ),
    )
  }
  return positions
}

function buildHorizRing(lng, lat, height, radiusM, segments = 48) {
  const positions = []
  const latRad = Cesium.Math.toRadians(lat)
  const mPerDegLon = 111319 * Math.cos(latRad)
  const mPerDegLat = 111319
  for (let i = 0; i <= segments; i += 1) {
    const ang = (i / segments) * Math.PI * 2
    positions.push(
      Cesium.Cartesian3.fromDegrees(
        lng + (Math.sin(ang) * radiusM) / mPerDegLon,
        lat + (Math.cos(ang) * radiusM) / mPerDegLat,
        height,
      ),
    )
  }
  return positions
}

function buildSweepFan(lng, lat, height, headingDeg, radiusM, fovDeg = 62) {
  const positions = [Cesium.Cartesian3.fromDegrees(lng, lat, height)]
  const latRad = Cesium.Math.toRadians(lat)
  const mPerDegLon = 111319 * Math.cos(latRad)
  const mPerDegLat = 111319
  const start = headingDeg - fovDeg / 2
  const end = headingDeg + fovDeg / 2
  for (let i = 0; i <= 20; i += 1) {
    const ang = Cesium.Math.toRadians(start + ((end - start) * i) / 20)
    positions.push(
      Cesium.Cartesian3.fromDegrees(
        lng + (Math.sin(ang) * radiusM) / mPerDegLon,
        lat + (Math.cos(ang) * radiusM) / mPerDegLat,
        height - 6,
      ),
    )
  }
  return positions
}

/** 计算相机视锥体 3D 角点（ENU 局部坐标 → 世界坐标） */
function computeFrustum3D(snapshot) {
  const {
    lng, lat, height, heading, pitch,
    horizontalFov, verticalFov, distanceM,
  } = snapshot
  const origin = Cesium.Cartesian3.fromDegrees(lng, lat, height)
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin)

  const headingRad = Cesium.Math.toRadians(heading)
  const pitchRad = Cesium.Math.toRadians(pitch)

  const fLocal = new Cesium.Cartesian3(
    Math.sin(headingRad) * Math.cos(pitchRad),
    Math.cos(headingRad) * Math.cos(pitchRad),
    Math.sin(pitchRad),
  )
  Cesium.Cartesian3.normalize(fLocal, fLocal)

  let rLocal = Cesium.Cartesian3.cross(fLocal, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3())
  if (Cesium.Cartesian3.magnitude(rLocal) < 1e-4) {
    rLocal = Cesium.Cartesian3.cross(fLocal, Cesium.Cartesian3.UNIT_X, rLocal)
  }
  Cesium.Cartesian3.normalize(rLocal, rLocal)

  const uLocal = Cesium.Cartesian3.cross(rLocal, fLocal, new Cesium.Cartesian3())
  Cesium.Cartesian3.normalize(uLocal, uLocal)

  const halfH = distanceM * Math.tan(Cesium.Math.toRadians(horizontalFov / 2))
  const halfV = distanceM * Math.tan(Cesium.Math.toRadians(verticalFov / 2))

  const toWorld = (lx, ly, lz) => {
    const local = new Cesium.Cartesian3(lx, ly, lz)
    return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3())
  }

  const corner = (sx, sy) => {
    const lx = fLocal.x * distanceM + rLocal.x * sx * halfH + uLocal.x * sy * halfV
    const ly = fLocal.y * distanceM + rLocal.y * sx * halfH + uLocal.y * sy * halfV
    const lz = fLocal.z * distanceM + rLocal.z * sx * halfH + uLocal.z * sy * halfV
    return toWorld(lx, ly, lz)
  }

  const corners = {
    tl: corner(-1, 1),
    tr: corner(1, 1),
    br: corner(1, -1),
    bl: corner(-1, -1),
  }

  const tierRatios = [0.28, 0.52, 0.76]
  const tiers = tierRatios.map((t) => {
    const d = distanceM * t
    const hh = d * Math.tan(Cesium.Math.toRadians(horizontalFov / 2))
    const hv = d * Math.tan(Cesium.Math.toRadians(verticalFov / 2))
    const tc = (sx, sy) => {
      const lx = fLocal.x * d + rLocal.x * sx * hh + uLocal.x * sy * hv
      const ly = fLocal.y * d + rLocal.y * sx * hh + uLocal.y * sy * hv
      const lz = fLocal.z * d + rLocal.z * sx * hh + uLocal.z * sy * hv
      return toWorld(lx, ly, lz)
    }
    return { t, tl: tc(-1, 1), tr: tc(1, 1), br: tc(1, -1), bl: tc(-1, -1) }
  })

  return { origin, corners, tiers, halfH, halfV }
}

function frustumEdgeLines(origin, corners) {
  const { tl, tr, br, bl } = corners
  return [
    [origin, tl], [origin, tr], [origin, br], [origin, bl],
    [tl, tr], [tr, br], [br, bl], [bl, tl],
  ]
}

function tierQuadPositions(tier) {
  return [tier.tl, tier.tr, tier.br, tier.bl, tier.tl]
}

/**
 * @param {import('cesium').Scene} scene
 * @param {import('cesium').Viewer} viewer
 */
export function createWaypointViewshedPool(scene, viewer, options = {}) {
  if (!scene || !viewer || typeof Cesium.ViewShed3D !== 'function') {
    // 原生 Cesium 不提供 ViewShed3D（商业发行版的扩展类），
    // 因此开源版不做逐像素的三维可视域体渲染：
    //   · 羽量降级为 noop，扫描特效、盲区矢量、2.5D 面积估算仍然可用；
    //   · 若需要精确立体可视域，请自行实现射线求交（Ray + pickPosition），
    //     或参考 README「未包含的部分」接入自建分析服务。
    console.info('[waypointViewshedPool] 未检测到 ViewShed3D，三维可视域体渲染降级')
    return createNoopPool()
  }
  if (scene.pickPositionSupported === false) {
    console.warn('[waypointViewshedPool] 不支持深度纹理，将仅显示扫描特效')
  }

  const config = {
    distanceM: options.distanceM ?? 500,
    horizontalFov: options.horizontalFov ?? 60,
    verticalFov: options.verticalFov ?? 40,
    pitchDeg: options.pitchDeg ?? -28,
  }

  const canUseViewshed3D = scene.pickPositionSupported !== false

  /** @type {Map<string, object>} */
  const pool = new Map()
  let activeEntry = null
  let layerVisible = true
  let pulseTimer = null
  let fxState = null

  const requestRender = () => scene.requestRender?.()

  const removeWaypointEffects = (waypointId) => {
    if (!viewer?.entities) return
    viewer.entities.values
      .filter((e) => e.id && String(e.id).startsWith(`${FX_PREFIX}-${waypointId}-`))
      .forEach((e) => viewer.entities.remove(e))
  }

  const setEffectsVisible = (waypointId, visible) => {
    if (!viewer?.entities) return
    viewer.entities.values.forEach((e) => {
      if (e.id && String(e.id).startsWith(`${FX_PREFIX}-${waypointId}-`)) {
        e.show = visible
      }
    })
  }

  const disposeEntry = (entry) => {
    if (!entry) return
    disposeViewshed3D(entry.viewshed3D)
    removeWaypointEffects(entry.id)
  }

  const createFrustum3DEffects = (waypointId, snapshot, palette) => {
    const glow = Cesium.Color.fromCssColorString(palette.glow)
    const beam = Cesium.Color.fromCssColorString(palette.beam)
    const frustum = computeFrustum3D(snapshot)
    const edges = frustumEdgeLines(frustum.origin, frustum.corners)

    edges.forEach((positions, i) => {
      viewer.entities.add({
        id: fxId(waypointId, `frustum-edge-${i}`),
        show: layerVisible,
        polyline: {
          positions,
          width: i < 4 ? 2.5 : 1.8,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: i < 4 ? 0.38 : 0.28,
            color: glow.withAlpha(i < 4 ? 0.82 : 0.55),
          }),
        },
      })
    })

    // 左右侧壁光幕（立体透视感）
    const { origin, corners } = frustum
    const walls = [
      [origin, corners.tl, corners.bl],
      [origin, corners.tr, corners.br],
    ]
    walls.forEach((positions, i) => {
      viewer.entities.add({
        id: fxId(waypointId, `frustum-wall-${i}`),
        show: layerVisible,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: glow.withAlpha(0.1),
          outline: true,
          outlineColor: beam.withAlpha(0.45),
          perPositionHeight: true,
        },
      })
    })

    // 底面半透明光幕
    viewer.entities.add({
      id: fxId(waypointId, 'frustum-cap'),
      show: layerVisible,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([
          corners.tl, corners.tr, corners.br, corners.bl,
        ]),
        material: beam.withAlpha(0.08),
        outline: true,
        outlineColor: glow.withAlpha(0.5),
        perPositionHeight: true,
      },
    })

    // 分层横截面环（近 → 远）
    frustum.tiers.forEach((tier, i) => {
      viewer.entities.add({
        id: fxId(waypointId, `frustum-tier-${i}`),
        show: layerVisible,
        polyline: {
          positions: tierQuadPositions(tier),
          width: 2,
          material: glow.withAlpha(0.35 + i * 0.12),
        },
      })
    })
  }

  const updateFrustum3DEffects = (waypointId, snapshot, palette) => {
    const glow = Cesium.Color.fromCssColorString(palette.glow)
    const frustum = computeFrustum3D(snapshot)
    const edges = frustumEdgeLines(frustum.origin, frustum.corners)

    edges.forEach((positions, i) => {
      const ent = viewer.entities.getById(fxId(waypointId, `frustum-edge-${i}`))
      if (ent?.polyline) ent.polyline.positions = positions
    })

    const { origin, corners } = frustum
    const walls = [
      [origin, corners.tl, corners.bl],
      [origin, corners.tr, corners.br],
    ]
    walls.forEach((positions, i) => {
      const ent = viewer.entities.getById(fxId(waypointId, `frustum-wall-${i}`))
      if (ent?.polygon) ent.polygon.hierarchy = new Cesium.PolygonHierarchy(positions)
    })

    const cap = viewer.entities.getById(fxId(waypointId, 'frustum-cap'))
    if (cap?.polygon) {
      cap.polygon.hierarchy = new Cesium.PolygonHierarchy([
        corners.tl, corners.tr, corners.br, corners.bl,
      ])
    }

    frustum.tiers.forEach((tier, i) => {
      const ent = viewer.entities.getById(fxId(waypointId, `frustum-tier-${i}`))
      if (ent?.polyline) ent.polyline.positions = tierQuadPositions(tier)
    })
  }

  const createObserverEffects = (waypointId, snapshot, palette, waypointIndex) => {
    removeWaypointEffects(waypointId)
    const pos = Cesium.Cartesian3.fromDegrees(snapshot.lng, snapshot.lat, snapshot.height)
    const glow = Cesium.Color.fromCssColorString(palette.glow)
    const beam = Cesium.Color.fromCssColorString(palette.beam)

    fxState = {
      waypointId,
      heading: 0,
      scanDist: 60,
      fanRadius: 80,
      phase: 0,
    }

    viewer.entities.add({
      id: fxId(waypointId, 'core'),
      position: pos,
      show: layerVisible,
      point: {
        pixelSize: 14,
        color: glow.withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'halo'),
      position: pos,
      show: layerVisible,
      ellipsoid: {
        radii: new Cesium.Cartesian3(14, 14, 14),
        material: glow.withAlpha(0.32),
        outline: true,
        outlineColor: glow.withAlpha(0.85),
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'pillar'),
      position: pos,
      show: layerVisible,
      cylinder: {
        length: Math.min(120, snapshot.height * 0.15),
        topRadius: 3,
        bottomRadius: 10,
        material: beam.withAlpha(0.22),
        outline: true,
        outlineColor: glow.withAlpha(0.5),
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'beam'),
      show: layerVisible,
      polyline: {
        positions: [
          pos,
          Cesium.Cartesian3.fromDegrees(snapshot.lng, snapshot.lat, Math.max(snapshot.height - 80, 0)),
        ],
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.35,
          color: beam.withAlpha(0.85),
        }),
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'sweep-fan'),
      show: layerVisible,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          buildSweepFan(snapshot.lng, snapshot.lat, snapshot.height, 0, 80, config.horizontalFov + 6),
        ),
        material: glow.withAlpha(0.14),
        outline: true,
        outlineColor: glow.withAlpha(0.65),
        perPositionHeight: true,
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'scan-arc'),
      show: layerVisible,
      polyline: {
        positions: buildHorizArc(snapshot.lng, snapshot.lat, snapshot.height, 0, 55, 34),
        width: 5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.45,
          color: glow.withAlpha(0.88),
        }),
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'scan-ring'),
      show: layerVisible,
      polyline: {
        positions: buildHorizRing(snapshot.lng, snapshot.lat, snapshot.height, 35),
        width: 2,
        material: glow.withAlpha(0.38),
      },
    })

    viewer.entities.add({
      id: fxId(waypointId, 'label'),
      position: pos,
      show: layerVisible,
      label: {
        text: `◈ 可视域 #${(waypointIndex ?? 0) + 1}`,
        font: 'bold 13px sans-serif',
        fillColor: glow,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    createFrustum3DEffects(waypointId, snapshot, palette)
  }

  const updateScanEffects = (waypointId, snapshot, palette, heading, scanDist) => {
    const scanSnapshot = {
      ...snapshot,
      heading,
      distanceM: scanDist,
    }
    updateFrustum3DEffects(waypointId, scanSnapshot, palette)

    if (fxState?.waypointId === waypointId) {
      fxState.heading = heading
      fxState.scanDist = scanDist
      fxState.fanRadius = Math.max(70, scanDist * 0.82)
    }

    const fan = viewer.entities.getById(fxId(waypointId, 'sweep-fan'))
    if (fan?.polygon) {
      fan.polygon.hierarchy = new Cesium.PolygonHierarchy(
        buildSweepFan(
          snapshot.lng,
          snapshot.lat,
          snapshot.height,
          heading,
          fxState?.fanRadius ?? scanDist,
          config.horizontalFov + 6,
        ),
      )
    }

    const arc = viewer.entities.getById(fxId(waypointId, 'scan-arc'))
    if (arc?.polyline) {
      arc.polyline.positions = buildHorizArc(
        snapshot.lng,
        snapshot.lat,
        snapshot.height,
        heading,
        Math.max(50, scanDist * 0.55),
        36,
      )
    }

    const ring = viewer.entities.getById(fxId(waypointId, 'scan-ring'))
    if (ring?.polyline) {
      ring.polyline.positions = buildHorizRing(
        snapshot.lng,
        snapshot.lat,
        snapshot.height,
        Math.max(30, scanDist * 0.36),
      )
    }
  }

  const startIdlePulse = () => {
    if (pulseTimer) return
    pulseTimer = setInterval(() => {
      if (!layerVisible || pool.size === 0) return
      const phase = performance.now() / 400
      pool.forEach((entry) => {
        pulseViewshedColors(entry, phase + entry.pulseOffset, true)
      })
      requestRender()
    }, 250)
  }

  const stopIdlePulse = () => {
    if (pulseTimer) {
      clearInterval(pulseTimer)
      pulseTimer = null
    }
  }

  const restoreEntry = (entry) => {
    setViewshedVisible(entry, layerVisible)
    setEffectsVisible(entry.id, layerVisible)
  }

  const createActiveEntry = (waypointId, waypointIndex) => {
    const palette = pickPalette(waypointIndex)
    return {
      id: waypointId,
      waypointIndex,
      viewshed3D: canUseViewshed3D ? new Cesium.ViewShed3D(scene) : null,
      viewshedName: allocViewshedName(waypointId, waypointIndex),
      registered: false,
      palette,
      pulseOffset: waypointIndex * 0.7,
      snapshot: null,
    }
  }

  return {
    isSupported: () => true,
    getCount: () => pool.size,

    async runWaypointAnalysis({
      waypointId,
      waypointIndex = 0,
      observer,
      pitchDeg,
      scanStepDeg = 15,
      onHeading,
      onProgress,
      isCancelled,
    }) {
      if (!observer) return

      if (pool.has(waypointId)) {
        disposeEntry(pool.get(waypointId))
        pool.delete(waypointId)
      }

      activeEntry = createActiveEntry(waypointId, waypointIndex)
      const { palette } = activeEntry

      const lng = observer.lng
      const lat = observer.lat
      const height = Number.isFinite(observer.height) ? observer.height : 0
      const pitch = Number.isFinite(pitchDeg) ? pitchDeg : config.pitchDeg
      const maxDist = config.distanceM
      const stepDeg = Math.max(12, scanStepDeg)
      const scanSteps = Math.ceil(360 / stepDeg)

      const baseSnapshot = {
        lng,
        lat,
        height,
        pitch,
        heading: 0,
        horizontalFov: config.horizontalFov,
        verticalFov: config.verticalFov,
        distanceM: maxDist,
      }

      createObserverEffects(waypointId, baseSnapshot, palette, waypointIndex)

      // 阶段 1：纯特效环视（不触发 ViewShed3D，避免深度缓冲拖死主线程）
      for (let step = 0; step <= scanSteps; step += 1) {
        if (isCancelled?.()) return
        const heading = Math.min(360, step * stepDeg)
        const t = step / scanSteps
        const scanDist = maxDist * (0.12 + t * 0.45)
        updateScanEffects(waypointId, baseSnapshot, palette, heading, scanDist)
        onHeading?.(heading)
        onProgress?.((step / scanSteps) * 0.68, 'scan')
        requestRender()
        await sleep(SCAN_STEP_MS)
      }

      // 阶段 2：特效距离展开
      const buildFxSteps = 10
      for (let i = 1; i <= buildFxSteps; i += 1) {
        if (isCancelled?.()) return
        const t = i / buildFxSteps
        const ease = 1 - (1 - t) ** 2
        const dist = maxDist * (0.55 + 0.45 * ease)
        updateScanEffects(waypointId, baseSnapshot, palette, ease * 360, dist)
        onProgress?.(0.68 + ease * 0.22, 'build')
        requestRender()
        await sleep(BUILD_FX_STEP_MS)
      }

      // 阶段 3：一次性注册立体可视域（仅 build 一次）+ 最终视锥
      activeEntry.snapshot = { ...baseSnapshot, heading: 0, distanceM: maxDist }
      updateFrustum3DEffects(waypointId, activeEntry.snapshot, palette)
      if (canUseViewshed3D && activeEntry.viewshed3D) {
        registerViewshed(activeEntry, layerVisible)
      }

      const ring = viewer.entities.getById(fxId(waypointId, 'scan-ring'))
      if (ring?.polyline) {
        ring.polyline.positions = buildHorizRing(lng, lat, height, maxDist * 0.85)
        ring.polyline.width = 3
      }

      const fan = viewer.entities.getById(fxId(waypointId, 'sweep-fan'))
      if (fan) fan.show = false

      pool.set(waypointId, activeEntry)
      activeEntry = null
      fxState = null
      if (pool.size > 0) startIdlePulse()
      onProgress?.(1, 'done')
      requestRender()
    },

    setLayerVisible(visible) {
      layerVisible = !!visible
      pool.forEach((entry) => restoreEntry(entry))
      if (activeEntry?.viewshed3D) {
        setViewshedVisible(activeEntry, layerVisible)
        setEffectsVisible(activeEntry.id, layerVisible)
      }
      if (!layerVisible) stopIdlePulse()
      else if (pool.size > 0) startIdlePulse()
      requestRender()
    },

    clearActiveScan() {
      if (!activeEntry) return
      disposeEntry(activeEntry)
      activeEntry = null
      fxState = null
      requestRender()
    },

    clearAll() {
      stopIdlePulse()
      this.clearActiveScan()
      pool.forEach((entry) => disposeEntry(entry))
      pool.clear()
      fxState = null
      requestRender()
    },

    destroy() {
      this.clearAll()
    },
  }
}
