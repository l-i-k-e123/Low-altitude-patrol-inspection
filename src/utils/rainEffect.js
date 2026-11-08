/**
 * rainEffect.js — 地图区域降雨特效
 *
 * 作用：在指定矩形经纬度区域内渲染 Billboard 雨滴，模拟局部下雨效果。
 *       支持按区域面积自动计算雨滴密度；图片白底自动抠透明。
 *
 * 主要导出：
 *   updateRainEffect(viewer, regions) — 创建/刷新降雨特效
 *   clearRainEffect(viewer)           — 清除特效
 *   isRainEffectActive()              — 是否正在显示
 *
 * 被谁使用：Enhanced3DMap.vue（toggleRainLayer / syncRainFromWeather）
 */
/** 地图区域下雨特效（Billboard 雨滴） */
import Cesium from '@/utils/cesiumCompat'

const RAIN_IMAGE = '/tubiao/yu.jpg'

const FALLBACK_RAIN_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
  + '<path fill="rgba(100,180,255,0.85)" d="M16 4c-4 6-10 11-10 17a10 10 0 0 0 20 0c0-6-6-11-10-17z"/>'
  + '</svg>'
)}`

/** 与演示局部区域（约 6km×6km）对应的参考密度 */
export const REFERENCE_RAIN_AREA = 0.06 * 0.06
export const REFERENCE_DROP_COUNT = 380

const DEFAULT_CONFIG = {
  dropSize: 11,
  minHeight: 350,
  maxHeight: 2200,
  fallSpeed: 38,
  maxDrops: 1400,
}

let rainState = null
const transparentImageCache = new Map()

/** 将 JPG 白底抠成透明 PNG，去除雨滴周围白色方块 */
function loadTransparentRainImage(src, threshold = 235) {
  if (transparentImageCache.has(src)) {
    return transparentImageCache.get(src)
  }

  const promise = new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const { data } = imageData

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const brightness = (r + g + b) / 3
          if (brightness >= threshold) {
            data[i + 3] = 0
          } else if (brightness >= threshold - 35) {
            data[i + 3] = Math.round(((threshold - 35 - brightness) / 35) * data[i + 3])
          }
        }

        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        console.warn('雨滴图片透明化处理失败，使用 SVG 备用:', err)
        resolve(FALLBACK_RAIN_SVG)
      }
    }
    img.onerror = () => {
      console.warn('雨滴图片加载失败，使用 SVG 备用')
      resolve(FALLBACK_RAIN_SVG)
    }
    img.src = src
  })

  transparentImageCache.set(src, promise)
  return promise
}

function regionArea(region) {
  return Math.max(0.00001, (region.max_lng - region.min_lng) * (region.max_lat - region.min_lat))
}

/** 按区域面积固定密度，雨势大小不改变雨滴数量/尺寸/速度 */
function calcDropCount(regions, config) {
  const totalArea = regions.reduce((sum, r) => sum + regionArea(r), 0)
  const count = Math.round(REFERENCE_DROP_COUNT * (totalArea / REFERENCE_RAIN_AREA))
  return Math.min(config.maxDrops, Math.max(120, count))
}

function pickRegionByArea(regions) {
  const totalArea = regions.reduce((sum, r) => sum + regionArea(r), 0)
  if (totalArea <= 0) return regions[0]
  let rnd = Math.random() * totalArea
  for (const region of regions) {
    rnd -= regionArea(region)
    if (rnd <= 0) return region
  }
  return regions[regions.length - 1]
}

function randomHeight(config) {
  return config.minHeight + Math.random() * (config.maxHeight - config.minHeight)
}

function spawnPosition(region, config) {
  const lng = region.min_lng + Math.random() * (region.max_lng - region.min_lng)
  const lat = region.min_lat + Math.random() * (region.max_lat - region.min_lat)
  return Cesium.Cartesian3.fromDegrees(lng, lat, randomHeight(config))
}

function createDrops(viewer, regions, config, rainImage) {
  const collection = viewer.scene.primitives.add(new Cesium.BillboardCollection())
  const drops = []
  const count = calcDropCount(regions, config)
  const size = config.dropSize

  for (let i = 0; i < count; i += 1) {
    const region = pickRegionByArea(regions)
    const billboard = collection.add({
      position: spawnPosition(region, config),
      image: rainImage,
      width: size,
      height: size,
      scaleByDistance: new Cesium.NearFarScalar(2000000, 0.85, 8000000, 0.25),
    })
    drops.push({ billboard, region })
  }

  return { collection, drops }
}

function updateDrops(drops, config) {
  const ellipsoid = Cesium.Ellipsoid.WGS84
  const speed = config.fallSpeed

  for (const drop of drops) {
    const carto = ellipsoid.cartesianToCartographic(drop.billboard.position)
    let height = carto.height

    if (height < 0) {
      drop.billboard.position = spawnPosition(drop.region, config)
      continue
    }

    height -= speed
    drop.billboard.position = Cesium.Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      height
    )
  }
}

export function isRainEffectActive() {
  return !!rainState
}

export async function updateRainEffect(viewer, regions, options = {}) {
  if (!viewer || viewer.isDestroyed()) return

  clearRainEffect(viewer)
  if (!regions?.length) return

  const config = { ...DEFAULT_CONFIG, ...options }
  const rainImage = await loadTransparentRainImage(RAIN_IMAGE)
  const { collection, drops } = createDrops(viewer, regions, config, rainImage)

  const removeListener = viewer.scene.postRender.addEventListener(() => {
    updateDrops(drops, config)
  })

  rainState = { viewer, collection, drops, removeListener, config, regions }
  viewer.scene.requestRender()
}

export function clearRainEffect(viewer) {
  if (!rainState) return

  if (rainState.removeListener) {
    rainState.removeListener()
  }
  const v = viewer || rainState.viewer
  if (v && !v.isDestroyed() && rainState.collection) {
    v.scene.primitives.remove(rainState.collection)
    v.scene.requestRender()
  }
  rainState = null
}
