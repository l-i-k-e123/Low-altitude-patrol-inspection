/**
 * dronePatrolEngine.js — 无人机巡航引擎
 *
 * 作用：驱动无人机沿地铁线路路径自动巡航（起飞→最近航点→单向至终点→返航）。
 *       飞行高度与航线规划 fixedHeight / 各航点 height 一致。
 *
 * 巡航阶段：APPROACH → FORWARD → REVERSE → RETURN → DONE
 *
 * 主要导出：
 *   createDronePatrolManager(options) — 创建巡航管理器
 *     · startPatrol / stopPatrol / getPosition / attachTick / destroy
 *
 * 被谁使用：Enhanced3DMap.vue（ensureDronePatrols / syncFleetFromStore）
 */
import Cesium from '@/utils/cesiumCompat'
import { droneOrientationQuaternion } from './mapMarkerEffects'

const PHASE = {
  APPROACH: 'approach',
  FORWARD: 'forward',
  REVERSE: 'reverse',
  RETURN: 'return',
  HOVER: 'hover',
  FORCE_RETURN: 'force_return',
  DONE: 'done',
}

const DEFAULT_SPEED = 65

function breathOffset() {
  return Math.sin((performance.now() / 2800) * Math.PI * 2) * 1.2
}

function toCartesian(lng, lat, height) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height)
}

function distM(a, b) {
  const dx = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  const dy = (b.lat - a.lat) * 110540
  const dz = (b.height ?? 0) - (a.height ?? 0)
  return Math.hypot(dx, dy, dz)
}

function lerpPoint(a, b, t) {
  return {
    lng: a.lng + (b.lng - a.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    height: (a.height ?? 0) + ((b.height ?? 0) - (a.height ?? 0)) * t,
  }
}

function segmentHeading(from, to) {
  const lat1 = Cesium.Math.toRadians(from.lat)
  const lat2 = Cesium.Math.toRadians(to.lat)
  const dLon = Cesium.Math.toRadians(to.lng - from.lng)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return Math.atan2(y, x)
}

function bindDynamicPosition(entry) {
  const pos = { lng: 0, lat: 0, height: 100, heading: 0 }
  const property = new Cesium.CallbackProperty(() => {
    return toCartesian(pos.lng, pos.lat, pos.height + breathOffset())
  }, false)
  const ringProperty = new Cesium.CallbackProperty(() => {
    return toCartesian(pos.lng, pos.lat, pos.height)
  }, false)
  const orientationProperty = new Cesium.CallbackProperty(() => {
    return droneOrientationQuaternion(pos.lng, pos.lat, pos.height, pos.heading)
  }, false)

  if (entry?.model) {
    entry.model.position = property
    entry.model.orientation = orientationProperty
  }
  entry?.rings?.forEach((ring) => {
    if (ring) ring.position = ringProperty
  })
  return pos
}

function setPos(posRef, point) {
  posRef.lng = point.lng
  posRef.lat = point.lat
  posRef.height = point.height ?? posRef.height
}

function findNearestPathIndex(from, path) {
  let nearestIdx = 0
  let nearestDist = Infinity
  for (let i = 0; i < path.length; i += 1) {
    const d = distM(from, path[i])
    if (d < nearestDist) {
      nearestDist = d
      nearestIdx = i
    }
  }
  if (nearestIdx >= path.length - 1 && path.length >= 2) {
    nearestIdx = path.length - 2
  }
  return nearestIdx
}

function normalizePathPoints(pathPoints, cruiseHeight) {
  const fallback = cruiseHeight ?? 600
  return (pathPoints || []).map((p) => ({
    lng: p.lng,
    lat: p.lat,
    height: p.height ?? fallback,
  }))
}

function slicePathFromNearest(home, fullPath) {
  if (fullPath.length < 2) return fullPath
  const startIdx = findNearestPathIndex(home, fullPath)
  const sliced = fullPath.slice(startIdx)
  return sliced.length >= 2 ? sliced : fullPath.slice(Math.max(0, fullPath.length - 2))
}

export function createDronePatrolManager(options = {}) {
  const speed = options.speed ?? DEFAULT_SPEED
  const onComplete = options.onComplete
  const onPositionUpdate = options.onPositionUpdate
  const onWaypointHover = options.onWaypointHover
  const hoverAtWaypoints = options.hoverAtWaypoints !== false
  /** @type {Map<string, object>} */
  const sessions = new Map()
  let tickAttached = false
  let tickViewer = null
  let lastTime = performance.now()

  const ensureTickAttached = () => {
    if (!tickViewer || tickAttached || sessions.size === 0) return
    tickViewer.clock.onTick.addEventListener(tick)
    tickAttached = true
    lastTime = performance.now()
  }

  const ensureTickDetached = () => {
    if (!tickViewer || !tickAttached || sessions.size > 0) return
    tickViewer.clock.onTick.removeEventListener(tick)
    tickAttached = false
  }

  const advance = (state, dt) => {
    if (state.phase === PHASE.HOVER || state.phase === PHASE.DONE) return

    const step = speed * dt
    state.progress += step

    while (state.progress >= state.segmentLen && state.phase !== PHASE.DONE) {
      state.progress -= state.segmentLen
      const arrivedAt = { ...state.segTo }
      const phaseBeforeAdvance = state.phase
      const pathIndexBefore = state.pathIndex

      if (!state.advanceSegment()) {
        state.progress = 0
        break
      }

      const shouldHover =
        hoverAtWaypoints &&
        (phaseBeforeAdvance === PHASE.FORWARD || phaseBeforeAdvance === PHASE.REVERSE) &&
        state.phase !== PHASE.FORCE_RETURN &&
        state.phase !== PHASE.RETURN &&
        state.phase !== PHASE.DONE

      if (shouldHover) {
        state.phase = PHASE.HOVER
        state.hoverResumePhase = phaseBeforeAdvance
        state.hoverPoint = arrivedAt
        state.hoverPathIndex = pathIndexBefore
        setPos(state.posRef, arrivedAt)
        onWaypointHover?.(state.fleetId, arrivedAt, pathIndexBefore, phaseBeforeAdvance)
        onPositionUpdate?.(state.fleetId, arrivedAt, PHASE.HOVER)
        return
      }
    }

    const t = state.segmentLen > 0 ? Math.min(1, state.progress / state.segmentLen) : 1
    const cur = lerpPoint(state.segFrom, state.segTo, t)
    state.posRef.heading = segmentHeading(state.segFrom, state.segTo)
    setPos(state.posRef, cur)
    onPositionUpdate?.(state.fleetId, cur, state.phase)
  }

  const buildSession = (fleetId, entry, cfg) => {
    const cruiseHeight = cfg.cruiseHeight ?? 600
    const fullPath = normalizePathPoints(cfg.pathPoints, cruiseHeight)
    if (fullPath.length < 2) return null

    const home = {
      lng: cfg.homeLng,
      lat: cfg.homeLat,
      height: cfg.homeHeight ?? 45,
    }

    const oneDirection = cfg.oneDirection !== false
    const path = oneDirection ? slicePathFromNearest(home, fullPath) : fullPath

    const posRef = bindDynamicPosition(entry)
    setPos(posRef, home)
    posRef.heading = segmentHeading(home, path[0])

    const state = {
      fleetId,
      entry,
      posRef,
      home,
      fullPath,
      path,
      cruiseHeight,
      oneDirection,
      phase: PHASE.APPROACH,
      phaseQueue: oneDirection
        ? [PHASE.FORWARD, PHASE.RETURN]
        : [PHASE.FORWARD, PHASE.REVERSE, PHASE.RETURN],
      pathIndex: 0,
      pathForward: true,
      returningHome: false,
      segFrom: { ...home },
      segTo: { ...path[0] },
      segmentLen: distM(home, path[0]),
      progress: 0,
      advanceSegment() {
        if (this.phase === PHASE.APPROACH) {
          this.phase = PHASE.FORWARD
          this.pathIndex = 0
          this.pathForward = true
          if (this.path.length < 2) {
            this.phase = PHASE.RETURN
            this.segFrom = { ...this.path[0] }
            this.segTo = { ...this.home }
            this.segmentLen = distM(this.segFrom, this.segTo)
            return true
          }
          this.segFrom = { ...this.path[0] }
          this.segTo = { ...this.path[1] }
          this.segmentLen = distM(this.segFrom, this.segTo)
          return true
        }

        if (this.phase === PHASE.FORWARD) {
          if (this.pathIndex < this.path.length - 2) {
            this.pathIndex += 1
            this.segFrom = { ...this.path[this.pathIndex] }
            this.segTo = { ...this.path[this.pathIndex + 1] }
            this.segmentLen = distM(this.segFrom, this.segTo)
            return true
          }
          this.phase = this.oneDirection ? PHASE.RETURN : PHASE.REVERSE
          if (this.oneDirection) {
            this.segFrom = { ...this.path[this.path.length - 1] }
            this.segTo = { ...this.home }
            this.segmentLen = distM(this.segFrom, this.segTo)
            return true
          }
          this.pathIndex = this.path.length - 1
          this.segFrom = { ...this.path[this.pathIndex] }
          this.segTo = { ...this.path[this.pathIndex - 1] }
          this.segmentLen = distM(this.segFrom, this.segTo)
          return true
        }

        if (this.phase === PHASE.REVERSE) {
          if (this.pathIndex > 1) {
            this.pathIndex -= 1
            this.segFrom = { ...this.path[this.pathIndex] }
            this.segTo = { ...this.path[this.pathIndex - 1] }
            this.segmentLen = distM(this.segFrom, this.segTo)
            return true
          }
          this.phase = PHASE.RETURN
          this.segFrom = { ...this.path[0] }
          this.segTo = { ...this.home }
          this.segmentLen = distM(this.segFrom, this.segTo)
          return true
        }

        if (this.phase === PHASE.RETURN) {
          this.phase = PHASE.DONE
          setPos(this.posRef, this.home)
          onComplete?.(this.fleetId)
          return false
        }

        if (this.phase === PHASE.FORCE_RETURN) {
          const backPath = this.fullPath?.length >= 2 ? this.fullPath : this.path
          if (this.returningHome) {
            this.phase = PHASE.DONE
            setPos(this.posRef, this.home)
            onComplete?.(this.fleetId)
            return false
          }
          if (this.pathIndex > 0) {
            this.pathIndex -= 1
            this.segFrom = { ...this.posRef, height: this.posRef.height ?? this.cruiseHeight }
            this.segTo = { ...backPath[this.pathIndex] }
            this.segmentLen = distM(this.segFrom, this.segTo)
            return true
          }
          this.segFrom = { ...this.posRef, height: this.posRef.height ?? this.cruiseHeight }
          this.segTo = { ...this.home }
          this.segmentLen = distM(this.segFrom, this.segTo)
          this.returningHome = true
          return true
        }

        return false
      },
      forceReturn() {
        if (this.phase === PHASE.DONE) return
        this.phase = PHASE.FORCE_RETURN
        this.returningHome = false
        this.pathForward = false
        const backPath = this.fullPath?.length >= 2 ? this.fullPath : this.path
        let nearestIdx = 0
        let nearestDist = Infinity
        for (let i = 0; i < backPath.length; i += 1) {
          const d = distM(this.posRef, backPath[i])
          if (d < nearestDist) {
            nearestDist = d
            nearestIdx = i
          }
        }
        this.pathIndex = nearestIdx
        this.path = backPath
        if (nearestIdx > 0) {
          this.segFrom = { ...this.posRef, height: this.posRef.height ?? this.cruiseHeight }
          this.segTo = { ...backPath[nearestIdx - 1] }
          this.segmentLen = distM(this.segFrom, this.segTo)
        } else {
          this.segFrom = { ...this.posRef, height: this.posRef.height ?? this.cruiseHeight }
          this.segTo = { ...backPath[0] }
          this.segmentLen = distM(this.segFrom, this.segTo)
        }
        this.progress = 0
      },
    }

    return state
  }

  const tick = () => {
    if (sessions.size === 0) {
      ensureTickDetached()
      return
    }
    const now = performance.now()
    const dt = Math.min(0.1, (now - lastTime) / 1000)
    lastTime = now
    for (const state of sessions.values()) {
      if (state.phase === PHASE.DONE) continue
      advance(state, dt)
    }
    tickViewer?.scene?.requestRender?.()
  }

  return {
    startPatrol(fleetId, entry, config) {
      if (sessions.has(fleetId)) return
      const state = buildSession(fleetId, entry, config)
      if (!state) return
      sessions.set(fleetId, state)
      ensureTickAttached()
    },

    getPosition(fleetId) {
      const state = sessions.get(fleetId)
      if (!state?.posRef) return null
      return {
        lng: state.posRef.lng,
        lat: state.posRef.lat,
        height: state.posRef.height,
      }
    },

    stopPatrol(fleetId) {
      sessions.delete(fleetId)
      ensureTickDetached()
    },

    forceReturn(fleetId) {
      const state = sessions.get(fleetId)
      if (!state) return false
      if (state.phase === PHASE.HOVER) {
        state.phase = state.hoverResumePhase || PHASE.FORWARD
      }
      state.forceReturn()
      return true
    },

    resumeFromHover(fleetId) {
      const state = sessions.get(fleetId)
      if (!state || state.phase !== PHASE.HOVER) return false
      state.phase = state.hoverResumePhase || PHASE.FORWARD
      state.hoverPoint = null
      return true
    },

    getPhase(fleetId) {
      return sessions.get(fleetId)?.phase ?? null
    },

    isHovering(fleetId) {
      return sessions.get(fleetId)?.phase === PHASE.HOVER
    },

    isPatrolling(fleetId) {
      return sessions.has(fleetId)
    },

    getActiveIds() {
      return new Set(sessions.keys())
    },

    attachTick(viewer) {
      if (!viewer) return
      tickViewer = viewer
    },

    detachTick(viewer) {
      if (!viewer) return
      if (tickAttached) {
        viewer.clock.onTick.removeEventListener(tick)
        tickAttached = false
      }
      if (tickViewer === viewer) tickViewer = null
    },

    destroy(viewer) {
      this.detachTick(viewer)
      sessions.clear()
    },
  }
}
