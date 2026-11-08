/**
 * sceneReady.js — Cesium 场景就绪检测（含瓦片监听判空与重试）
 */
const DEFAULT_TIMEOUT_MS = 30000
const RETRY_DELAY_MS = 400
const MAX_RETRIES = 8

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 等待 progressEvent 可用 */
async function waitForProgressEvent(getEvent, label = 'tile') {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const event = getEvent()
    if (event && typeof event.addEventListener === 'function') {
      return event
    }
    await sleep(RETRY_DELAY_MS)
  }
  console.warn(`[sceneReady] ${label} tileLoadProgressEvent 未就绪，跳过监听`)
  return null
}

export function waitForTileLoadProgress(progressEvent, getLoadedState, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!progressEvent || typeof progressEvent.addEventListener !== 'function') {
    return Promise.resolve()
  }
  if (getLoadedState?.()) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let started = false
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      removeListener?.()
      clearTimeout(timer)
      clearInterval(pollTimer)
      resolve()
    }

    let removeListener
    try {
      removeListener = progressEvent.addEventListener((pending) => {
        if (pending > 0) started = true
        if (getLoadedState?.() || (started && pending === 0)) {
          finish()
        }
      })
    } catch (err) {
      console.warn('[sceneReady] 瓦片进度监听注册失败:', err)
      finish()
      return
    }

    const pollTimer = setInterval(() => {
      if (getLoadedState?.()) finish()
    }, 150)

    const timer = setTimeout(finish, timeoutMs)
  })
}

export function waitForPostRender(viewer, frameCount = 2) {
  if (!viewer || viewer.isDestroyed?.()) {
    return Promise.resolve()
  }
  const scene = viewer.scene
  if (!scene?.postRender?.addEventListener) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let remaining = frameCount
    const remove = scene.postRender.addEventListener(() => {
      remaining -= 1
      if (remaining <= 0) {
        remove()
        resolve()
      }
    })
    scene.requestRender?.()
  })
}

export async function waitForSceneReady(viewer, tileset, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, waitForBuildingTileset = false } = options
  if (!viewer || viewer.isDestroyed?.()) return

  viewer.scene?.requestRender?.()
  await new Promise((resolve) => requestAnimationFrame(resolve))

  if (tileset?.readyPromise) {
    try {
      await tileset.readyPromise
    } catch (err) {
      console.warn('[sceneReady] 3D Tiles readyPromise 失败:', err)
    }
  }

  viewer.scene?.requestRender?.()

  const waits = []

  const globe = viewer.scene?.globe
  if (globe) {
    const globeEvent = await waitForProgressEvent(
      () => globe.tileLoadProgressEvent,
      'globe',
    )
    if (globeEvent) {
      waits.push(
        waitForTileLoadProgress(
          globeEvent,
          () => globe.tilesLoaded,
          Math.min(timeoutMs, 5000),
        ),
      )
    }
  }

  if (tileset && waitForBuildingTileset) {
    const tilesetEvent = await waitForProgressEvent(
      () => tileset.tileLoadProgressEvent,
      '3dtiles',
    )
    if (tilesetEvent) {
      waits.push(
        waitForTileLoadProgress(
          tilesetEvent,
          () => tileset.tilesLoaded,
          timeoutMs,
        ),
      )
    }
  }

  if (waits.length) {
    await Promise.all(waits)
  } else {
    await sleep(300)
  }

  await waitForPostRender(viewer, 2)
}
